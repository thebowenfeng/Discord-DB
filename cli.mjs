import {
    fetchGet,
    fetchPost,
    getAllRawRecords,
    getRecordJson,
    getSchema,
    postFile,
    jsonifyTree,
    FILE_SIZE_LIMIT, select, equals, greaterThan, lessThan, partOf, ascending, descending
} from "./common.mjs";
import RBTree from "./rbtree.mjs";
import DiscordDbClient from "./client.mjs";

const GUILD_ID = process.env.GUILD_ID;

async function createNumericalIndex(tableId, metaTableId, columnName) {
    const existingRecords = await getAllRawRecords(tableId);
    if (existingRecords.length === 0) {
        await postFile(metaTableId, '{}', `${columnName}_idx_0`);
    }
    let tree = new RBTree((a, b) => a.key - b.key);
    let indexNum = 0;
    for (const record of existingRecords) {
        const recordData = await getRecordJson(record);
        const treeNode = tree.find({ key: recordData[columnName] });
        if (treeNode === null) {
            tree.insert({ key: recordData[columnName], data: [record.id] });
        } else {
            treeNode.data.push(record.id);
        }
        const jsonObjString = JSON.stringify(jsonifyTree(tree._root));
        if (jsonObjString.length > FILE_SIZE_LIMIT) {
            await postFile(metaTableId, jsonObjString, `${columnName}_idx_${indexNum}`);
            indexNum += 1;
            tree = new RBTree((a, b) => a.key - b.key);
        }
    }
    await postFile(metaTableId, JSON.stringify(jsonifyTree(tree._root)), `${columnName}_idx_${indexNum}`);
}

async function createHashIndex(tableId, metaTableId, columnName) {
    const existingRecords = await getAllRawRecords(tableId);
    if (existingRecords.length === 0) {
        await postFile(metaTableId, '{}', `${columnName}_idx_0`);
    }
    let hashmap = {};
    let indexNum = 0;
    for (const record of existingRecords) {
        const recordData = await getRecordJson(record);
        const key = recordData[columnName].length > 1000 ? recordData[columnName].substring(0, 1000) : recordData[columnName];
        if (hashmap[key] !== undefined) {
            hashmap[key].push(record.id);
        } else {
            hashmap[key] = [record.id];
        }
        const hashmapString = JSON.stringify(hashmap);
        if (hashmapString.length > FILE_SIZE_LIMIT) {
            await postFile(metaTableId, hashmapString, `${columnName}_idx_${indexNum}`);
            indexNum += 1;
            hashmap = {};
        }
    }
    await postFile(metaTableId, JSON.stringify(hashmap), `${columnName}_idx_${indexNum}`);
}

async function createIndex(tableName, columnName) {
    const tables = await fetchGet(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`);
    const schema = await getSchema(tableName, tables);
    if (!Object.keys(schema).includes(columnName)) {
        return console.error(`Failed to create index for ${tableName} on ${columnName}: Column doesn't exist`);
    }
    const metaTableId = tables.filter((table) => table.name === `${tableName}_idx`)[0].id;
    const tableId = tables.filter((table) => table.name === tableName)[0].id;
    const metaRecords = await getAllRawRecords(metaTableId);
    if (metaRecords.some((obj) => obj.attachments[0].filename.startsWith(`${columnName}_idx`))) {
        return console.error(`Failed to create index for ${tableName} on ${columnName}: ${columnName}_idx_X already exists`);
    }
    if (schema[columnName] === 'num') {
        return await createNumericalIndex(tableId, metaTableId, columnName);
    } else if (schema[columnName] === 'str') {
        return await createHashIndex(tableId, metaTableId, columnName);
    }
}

async function createSchema(tableName, schema) {
    const tables = await fetchGet(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`);
    if (!tables.some((obj) => obj.name === `${tableName}_idx`) || !tables.some((obj) => obj.name === tableName)) {
        return console.error(`Failed to create schema for ${tableName}: ${tableName}_idx or ${tableName} doesn't exist`);
    }
    const records = await fetchGet(`https://discord.com/api/v10/channels/${tables.filter((obj) => obj.name === tableName)[0].id}/messages`);
    if (records.length !== 0) {
        return console.error(`Failed to create schema for ${tableName}: Already contains records`);
    }
    const metadata = await fetchGet(`https://discord.com/api/v10/channels/${tables.filter((obj) => obj.name === `${tableName}_idx`)[0].id}/messages`);
    if (metadata.length !== 0) {
        return console.error(`Failed to create schema for ${tableName}: Already contains existing schema and/or indexes`);
    }
    for (const [key, value] of Object.entries(schema)) {
        if (key === 'dbId') {
            return console.error(`Failed to create schema for ${tableName}: dbId is a reserved column`)
        }
        if (value.toLowerCase() !== 'num' && value.toLowerCase() !== 'str') {
            return console.error(`Failed to create schema for ${tableName}: Invalid data type for ${key} column`);
        }
    }
    await postFile(tables.filter((obj) => obj.name === `${tableName}_idx`)[0].id, JSON.stringify(schema), 'schema');
}

async function createTable(tableName) {
    const tables = await fetchGet(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`);
    if (tables.some((obj) => obj.name === tableName)) {
        return console.error(`${tableName} already exists`);
    }
    await fetchPost(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`, { name: tableName });
    await fetchPost(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`, { name: `${tableName}_idx` });
}

async function main() {
    const command = process.argv.slice(2).map((str) => str.toLowerCase());
    const client = new DiscordDbClient(GUILD_ID, process.env.TOKEN);

    // Process command
    if (command[0] === 'create' && command[1] === 'table') {
        return await createTable(command[2])
    }
    if (command[0] === 'create' && command[1] === 'schema') {
        if (command.length % 2 === 0 || command.length < 5) {
            return console.error("Failed to create schema: Invalid number of arguments specified");
        }
        const schema = {};
        let index = 3;
        while (index < command.length) {
            schema[command[index]] = command[index + 1];
            index += 2;
        }
        return await createSchema(command[2], schema);
    }
    if (command[0] === 'get' && command[1] === 'schema') {
        const tables = await fetchGet(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`);
        return console.log(await getSchema(command[2], tables));
    }
    if (command[0] === 'insert') {
        if (command.length % 2 !== 0 || command.length < 4) {
            return console.error("Failed to insert into table: Invalid number of arguments provided");
        }
        const data = {};
        let index = 2;
        while (index < command.length) {
            data[command[index]] = command[index + 1];
            index += 2;
        }
        return await client.insert(command[1], data);
    }
    if (command[0] === 'create' && command[1] === 'index') {
        return await createIndex(command[2], command[3]);
    }
    if (command[0] === 'select') {
        const query = select(command[1]);
        const conditionals = [];
        let currCmdIndex = 3;
        if (command[2] === 'where') {
            while (true) {
                if (command[currCmdIndex] === 'limit' || command[currCmdIndex] === 'orderby' || currCmdIndex >= command.length) {
                    break;
                }
                const columnName = command[currCmdIndex];
                const operator = command[currCmdIndex + 1];
                const value = command[currCmdIndex + 2];
                if (operator === '=') {
                    conditionals.push(equals(columnName, value));
                } else if (operator === '>') {
                    conditionals.push(greaterThan(columnName, value));
                } else if (operator === '<') {
                    conditionals.push(lessThan(columnName, value));
                } else if (operator === 'in') {
                    conditionals.push(partOf(columnName, JSON.parse(value)));
                } else {
                    return console.error("Failed to read into table: Invalid conditional query format");
                }
                currCmdIndex += 3;
            }
        }
        query.where(...conditionals);
        if (command[currCmdIndex] === 'orderby') {
            if (command[currCmdIndex + 2] === 'asc') {
                query.orderBy(ascending(command[currCmdIndex + 1]));
            } else if (command[currCmdIndex + 2] === 'dsc') {
                query.orderBy(descending(command[currCmdIndex + 1]));
            } else {
                return console.error("Failed to read into table: Invalid order query format");
            }
            currCmdIndex += 3;
        }
        if (command[currCmdIndex] === 'limit') {
            query.limitBy(!isNaN(Number(command[currCmdIndex + 1])) ? Number(command[currCmdIndex + 1]) : 0);
        }
        return console.log(await client.read(query));
    }
    if (command[0] === 'update') {
        if (command.length % 2 === 0 || command.length < 5) {
            return console.error("Failed to insert into table: Invalid number of arguments provided");
        }
        const data = {};
        let index = 3;
        while (index < command.length) {
            data[command[index]] = command[index + 1];
            index += 2;
        }
        return await client.update(command[1], command[2], data);
    }
    if (command[0] === 'delete') {
        return await client.delete(command[1], command[2]);
    }
}

main();