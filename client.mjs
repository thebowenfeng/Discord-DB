import {
    postMessage,
    fetchGet,
    getFile,
    postFile,
    getSchema,
    getAllRawRecords,
    FILE_SIZE_LIMIT,
    parseTreeJson,
    getRecordJson,
    jsonifyTree,
    deleteMessage,
    treeRangeSearch,
    getRecord,
    getAllRawRecordsWithLimit,
    getRawRecord, fetchPost, fetchPatch
} from "./common.mjs";
import RBTree from "./rbtree.mjs";

async function updateIndex(metaTableId, schema, column, treeFunc, hashFunc, token) {
    let validIndex = null;
    const metaRecords = await getAllRawRecords(metaTableId, token);
    for (const record of metaRecords) {
        const filename = record.attachments[0].filename.split('_');
        if (filename.length === 3 && record.attachments[0].size < FILE_SIZE_LIMIT - 100 && filename[1] === 'idx' && filename[0] === column) {
            validIndex = record;
            break;
        }
    }
    let maxIndexNum = -1;
    for (const record of metaRecords) {
        if (record.attachments[0].filename.split('_')[0] === column && Number(record.attachments[0].filename.split('_')[2]) > maxIndexNum) {
            maxIndexNum = Number(record.attachments[0].filename.split('_')[2]);
        }
    }
    if (schema[column] === 'num') {
        let tree = validIndex === null ? null : parseTreeJson(await getRecordJson(validIndex), token);
        if (tree === null) {
            tree = new RBTree((a, b) => a.key - b.key);
        }
        treeFunc(tree);
        await postFile(metaTableId, JSON.stringify(jsonifyTree(tree._root)), validIndex === null ? `${column}_idx_${maxIndexNum + 1}` : validIndex.attachments[0].filename, token);
    } else if (schema[column] === 'str') {
        let hashTable = validIndex === null ? {} : await getRecordJson(validIndex, token);
        hashFunc(hashTable);
        await postFile(metaTableId, JSON.stringify(hashTable), validIndex === null ? `${column}_idx_${maxIndexNum + 1}` : validIndex.attachments[0].filename, token);
    }
    if (validIndex !== null) {
        await deleteMessage(metaTableId, validIndex.id, token);
    }
}

async function getTableAndSchemaValidation(guildId, tableName, data, token) {
    const tables = await fetchGet(`https://discord.com/api/v10/guilds/${guildId}/channels`, token);
    if (!tables.some((obj) => obj.name === tableName)) {
        throw new Error(`Unable to insert into ${tableName}: No such table found`);
    }
    const schema = await getSchema(tableName, tables, token);
    if (data && Object.keys(schema).length !== Object.keys(data).length) {
        throw new Error(`Unable to insert into ${tableName}: Some columns are null`);
    }

    return { tables, schema };
}

function validateData(data, schema, tableName) {
    for (const [key, value] of Object.entries(data)) {
        const dataType = schema[key];
        if (dataType === 'num') {
            if (isNaN(Number(value))) {
                throw new Error(`Unable to insert into ${tableName}: ${key} column mismatched data type`)
            }
            data[key] = Number(value);
        } else if (dataType === 'str') {
            data[key] = value.toString();
        } else if (dataType === undefined) {
            throw new Error(`Unable to insert into ${tableName}: ${key} column doesn't exist`);
        }
    }
}

export default class DiscordDbClient {
    guildId;
    token;

    constructor(guildId, token) {
        this.guildId = guildId;
        this.token = token;
    }

    async insert(tableName, data) {
        const { tables, schema } = await getTableAndSchemaValidation(this.guildId, tableName, data, this.token);
        validateData(data, schema, tableName);
        const payload = JSON.stringify(data);
        const tableId = tables.filter((obj) => obj.name === tableName)[0].id;
        let newId = '';
        if (payload.length > 1950) {
            newId = (await postFile(tableId, payload, 'record', this.token)).id;
        } else {
            newId = (await postMessage(tableId, payload, this.token)).id;
        }

        const metaTableId = tables.filter((obj) => obj.name === `${tableName}_idx`)[0].id;
        for (const column of Object.keys(data)) {
            await updateIndex(metaTableId, schema, column, (tree) => {
                const treeNode = tree.find({ key: data[column] });
                if (treeNode === null) {
                    tree.insert({ key: data[column], data: [newId] });
                } else {
                    treeNode.data.push(newId);
                }
            }, (hashTable) => {
                const key = data[column].length > 1000 ? data[column].substring(0, 1000) : data[column];
                if (hashTable[key] !== undefined) {
                    hashTable[key].push(newId);
                } else {
                    hashTable[key] = [newId];
                }
            }, this.token);
        }
    }

    async read(query) {
        const start = Date.now();
        const tables = await fetchGet(`https://discord.com/api/v10/guilds/${this.guildId}/channels`, this.token);
        const tableId = tables.filter((obj) => obj.name === query.table)[0].id
        const metaTableId = tables.filter((obj) => obj.name === `${query.table}_idx`)[0].id;
        const metaRecords = await getAllRawRecords(metaTableId, this.token);
        const schema = await getSchema(query.table, tables, this.token);
        let jsonResults = [];

        if (query.conditionals.length > 0) {
            const queryFilterResult = [];
            let resultSet = [];
            const globalIndexCache = {};
            for (const condition of query.conditionals) {
                const validIndexes = [];
                for (const record of metaRecords) {
                    const filename = record.attachments[0].filename.split('_');
                    if (filename.length === 3 && filename[1] === 'idx' && filename[0] === condition.columnName) {
                        validIndexes.push(record);
                        if (globalIndexCache[record.attachments[0].filename] === undefined) {
                            if (schema[condition.columnName] === 'num') {
                                globalIndexCache[record.attachments[0].filename] = parseTreeJson(await getRecordJson(record, this.token), this.token);
                            } else if (schema[condition.columnName] === 'str') {
                                globalIndexCache[record.attachments[0].filename] = await getRecordJson(record, this.token);
                            }
                        }
                    }
                }
                if (validIndexes.length === 0) {
                    throw new Error(`Unable to read ${query.table}: No index exist for ${condition.columnName}`);
                }

                const localFilterResult = [];
                for (const validIndex of validIndexes) {
                    if (schema[condition.columnName] === 'num') {
                        const tree = globalIndexCache[validIndex.attachments[0].filename];
                        if (tree === null) {
                            return [];
                        }
                        if (condition.operator === '=') {
                            const treeNode = tree.find({ key: condition.value });
                            if (treeNode === null) {
                                return [];
                            }
                            localFilterResult.push(...treeNode.data);
                        } else if (condition.operator === '>') {
                            const res = [];
                            treeRangeSearch(tree._root, Number.MAX_SAFE_INTEGER, condition.value, res);
                            if (res.length === 0) {
                                return [];
                            }
                            localFilterResult.push(...res);
                        } else if (condition.operator === '<') {
                            const res = [];
                            treeRangeSearch(tree._root, condition.value, Number.MIN_SAFE_INTEGER, res);
                            if (res.length === 0) {
                                return [];
                            }
                            localFilterResult.push(...res);
                        } else if (condition.operator === 'in') {
                            let foundValid = false;
                            for (const val of condition.values) {
                                const treeNode = tree.find({ key: val });
                                if (treeNode !== null) {
                                    localFilterResult.push(...treeNode.data);
                                    foundValid = true;
                                }
                            }
                            if (!foundValid) {
                                return [];
                            }
                        } else {
                            throw new Error(`Unable to read ${query.table}: Query conditional ${condition} not recognised`);
                        }
                    } else if (schema[condition.columnName] === 'str') {
                        const hashTable = globalIndexCache[validIndex.attachments[0].filename];
                        if (condition.operator === '=') {
                            const res = hashTable[condition.value];
                            if (res === undefined) {
                                return [];
                            }
                            localFilterResult.push(...res);
                        } else if (condition.operator === 'in') {
                            let foundValid = false;
                            for (const val of condition.values) {
                                const res = hashTable[val];
                                if (res !== undefined) {
                                    localFilterResult.push(...res);
                                    foundValid = true;
                                }
                            }
                            if (!foundValid) {
                                return [];
                            }
                        } else {
                            throw new Error(`Unable to read ${query.table}: Query conditional ${condition} not recognised`);
                        }
                    }
                }
                queryFilterResult.push(localFilterResult);
            }
            const minSet = queryFilterResult.reduce((prev, curr) => prev.length <= curr.length ? prev : curr);
            for (const val of minSet) {
                if (queryFilterResult.every((arr) => arr.includes(val))) {
                    resultSet.push(val);
                }
            }
            if (query.limit !== 0) {
                resultSet = resultSet.slice(0, query.limit);
            }
            let batchExecutions = [];
            for (const messageId of resultSet) {
                batchExecutions.push(getRecord(tableId, messageId, this.token));
                if (batchExecutions.length === 5) {
                    const res = await Promise.all(batchExecutions);
                    res.forEach((obj) => jsonResults.push(obj));
                    batchExecutions = [];
                }
            }
            if (batchExecutions.length > 0) {
                const res = await Promise.all(batchExecutions);
                res.forEach((obj) => jsonResults.push(obj));
            }
        } else {
            let rawRecords;
            if (query.limit !== 0) {
                rawRecords = await getAllRawRecordsWithLimit(tableId, query.limit, this.token);
            } else {
                rawRecords = await getAllRawRecords(tableId, this.token);
            }
            for (const record of rawRecords) {
                jsonResults.push(await getRecordJson(record, this.token));
            }
        }

        if (query.order !== null) {
            jsonResults.sort((a, b) => {
                if (query.order.order === 'asc') {
                    return a[query.order.columnName] - b[query.order.columnName];
                } else if (query.order.order === 'dsc') {
                    return b[query.order.columnName] - a[query.order.columnName];
                }
                throw new Error(`Unable to read ${query.table}: Invalid order strategy ${query.order.order}`);
            });
        }
        return jsonResults;
    }

    async update(tableName, id, data) {
        const { tables, schema } = await getTableAndSchemaValidation(this.guildId, tableName, data, this.token);
        const tableId = tables.filter((obj) => obj.name === tableName)[0].id;
        const metaTableId = tables.filter((obj) => obj.name === `${tableName}_idx`)[0].id;
        const record = await getRawRecord(tableId, id, this.token);
        validateData(data, schema, tableName);
        const payload = JSON.stringify(data);
        const oldRecord = await getRecordJson(record, this.token);

        let newId;
        if (record.attachments.length > 0 || payload.length > 1950) {
            newId = (await postFile(tableId, payload, 'record', this.token)).id;
            await deleteMessage(tableId, id, this.token);
        } else {
            const resp = await fetchPatch(`https://discord.com/api/v10/channels/${tableId}/messages/${id}`, { content: payload }, this.token);
            newId = resp.id;
        }

        for (const column of Object.keys(data)) {
            await updateIndex(metaTableId, schema, column, (tree) => {
                let treeNode = tree.find({ key: oldRecord[column] });
                if (treeNode.data.length === 1) {
                    tree.remove({ key: oldRecord[column] });
                } else {
                    treeNode.data = treeNode.data.filter((it) => it !== id);
                }

                treeNode = tree.find({ key: data[column] });
                if (treeNode === null) {
                    tree.insert({ key: data[column], data: [newId] });
                } else {
                    treeNode.data.push(newId);
                }
            }, (hashTable) => {
                let key = oldRecord[column].length > 1000 ? oldRecord[column].substring(0, 1000) : oldRecord[column];
                if (hashTable[key].length !== 1) {
                    hashTable[key] = hashTable[key].filter((it) => it !== id);
                } else {
                    hashTable[key] = undefined;
                }

                key = data[column].length > 1000 ? data[column].substring(0, 1000) : data[column];
                if (hashTable[key] !== undefined) {
                    hashTable[key].push(newId);
                } else {
                    hashTable[key] = [newId];
                }
            }, this.token);
        }
    }

    async delete(tableName, id) {
        const { tables, schema } = await getTableAndSchemaValidation(this.guildId, tableName, undefined, this.token);
        const tableId = tables.filter((obj) => obj.name === tableName)[0].id;
        const metaTableId = tables.filter((obj) => obj.name === `${tableName}_idx`)[0].id;
        const record = await getRecordJson(await getRawRecord(tableId, id, this.token), this.token);


        await deleteMessage(tableId, id, this.token);

        for (const column of Object.keys(record)) {
            await updateIndex(metaTableId, schema, column, (tree) => {
                let treeNode = tree.find({ key: record[column] });
                if (treeNode.data.length === 1) {
                    tree.remove({ key: record[column] });
                } else {
                    treeNode.data = treeNode.data.filter((it) => it !== id);
                }
            }, (hashTable) => {
                let key = record[column].length > 1000 ? record[column].substring(0, 1000) : record[column];
                if (hashTable[key].length !== 1) {
                    hashTable[key] = hashTable[key].filter((it) => it !== id);
                } else {
                    hashTable[key] = undefined;
                }
            }, this.token);
        }
    }
}