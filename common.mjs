import RBTree, {Node} from "./rbtree.mjs";

const TOKEN = process.env.TOKEN;
export const FILE_SIZE_LIMIT = 25690000;

export function equals(columnName, value) {
    return {
        operator: '=',
        columnName,
        value
    }
}

export function greaterThan(columnName, value) {
    return {
        operator: '>',
        columnName,
        value
    }
}

export function lessThan(columnName, value) {
    return {
        operator: '<',
        columnName,
        value
    }
}

export function partOf(columnName, values) {
    return {
        operator: 'in',
        columnName,
        values
    }
}

export function ascending(columnName) {
    return {
        order: 'asc',
        columnName
    }
}

export function descending(columnName) {
    return {
        order: 'dsc',
        columnName
    }
}

export function select(tableName) {
    return new Query(tableName);
}

class Query {
    conditionals = [];
    limit = 0;
    order = null;
    table;

    constructor(tableName) {
        this.table = tableName;
    }

    where(...ops) {
        this.conditionals = [...this.conditionals, ...ops];
        return this;
    }

    limitBy(num) {
        if (num <= 0) {
            throw new Error(`Error constructing query: Cannot limit with 0 or less`);
        }
        this.limit = num;
        return this;
    }

    orderBy(op) {
        this.order = op;
        return this;
    }
}

export function treeRangeSearch(root, upper, lower, result) {
    if (root === null) {
        return;
    }
    if (lower < root.data.key && upper > root.data.key) {
        result.push(...root.data.data);
    }
    if (lower < root.data.key) {
        treeRangeSearch(root.left, upper, lower, result);
    }
    if (upper > root.data.key) {
        treeRangeSearch(root.right, upper, lower, result);
    }
}

export function parseTreeJson(treeJson) {
    function recursiveParse(nodeJson) {
        if (nodeJson === null) {
            return null;
        }
        const root = new Node(nodeJson.data);
        root.left = recursiveParse(nodeJson.left);
        root.right = recursiveParse(nodeJson.right);
        root.red = nodeJson.red;
        return root;
    }

    const tree = new RBTree((a, b) => a.key - b.key);
    if (Object.keys(treeJson).length === 0) {
        return null;
    }
    tree._root = recursiveParse(treeJson);
    return tree;
}

export function jsonifyTree(node) {
    if (node === null) {
        return null;
    }
    return {
        data: node.data,
        left: jsonifyTree(node.left),
        right: jsonifyTree(node.right),
        red: node.red,
    };
}

export async function getRecord(tableId, messageId, token=TOKEN) {
    const rawRecord = await getRawRecord(tableId, messageId, token);
    return await getRecordJson(rawRecord, token);
}

export async function getRawRecord(tableId, messageId, token=TOKEN) {
    return await fetchGet(`https://discord.com/api/v10/channels/${tableId}/messages/${messageId}`, token);
}

export async function getRecordJson(record, token=TOKEN) {
    let res;
    if (record.attachments.length > 0) {
        res = await getFile(record.attachments[0].url, token);
    } else {
        res = JSON.parse(record.content);
    }
    res.dbId = record.id;
    return res;
}

export async function getAllRawRecordsWithLimit(tableId, limit, token=TOKEN) {
    if (limit < 100) {
        return await fetchGet(`https://discord.com/api/v10/channels/${tableId}/messages?limit=${limit}`, token);
    }

    let initiaLimit = limit;
    const initial = await fetchGet(`https://discord.com/api/v10/channels/${tableId}/messages?limit=100`, token);
    const results = [...initial];
    let lastId = '';
    if (initial.length === 100) {
        while (true) {
            initiaLimit -= 100;
            const records = await fetchGet(`https://discord.com/api/v10/channels/${tableId}/messages?limit=${Math.max(initiaLimit, 100)}&before=${lastId}`, token);
            if (records.length === 0) {
                break;
            }
            if (records.length > initiaLimit) {
                results.push(...(records.slice(0, initiaLimit)));
                break;
            }
            results.push(...records);
            if (records.length !== 100 || initiaLimit < 100) {
                break;
            }
            lastId = records[99].id;
        }
    }
    return results;
}

export async function getAllRawRecords(tableId, token=TOKEN) {
    const initial = await fetchGet(`https://discord.com/api/v10/channels/${tableId}/messages?limit=100`, token);
    const results = [...initial];
    let lastId = '';
    if (initial.length === 100) {
        while (true) {
            const records = await fetchGet(`https://discord.com/api/v10/channels/${tableId}/messages?limit=100&before=${lastId}`, token);
            if (records.length === 0) {
                break;
            }
            results.push(...records);
            if (records.length !== 100) {
                break;
            }
            lastId = records[99].id;
        }
    }
    return results;
}

export async function getSchema(tableName, tables, token=TOKEN) {
    if (!tables.some((obj) => obj.name === `${tableName}_idx`)) {
        throw new Error(`Unable to get schema for ${tableName}: ${tableName}_idx not found`);
    }

    const metadata = await fetchGet(`https://discord.com/api/v10/channels/${tables.filter((obj) => obj.name === `${tableName}_idx`)[0].id}/messages`, token);
    if (metadata.filter((obj) => obj.attachments.some((file) => file.filename === 'schema')).length === 0) {
        throw new Error(`Unable to get schema for ${tableName}: No schema found`);
    }
    const schemaUrl = metadata.filter((obj) => obj.attachments.some((file) => file.filename === 'schema'))[0].attachments.filter((file) => file.filename === 'schema')[0].url;
    return await getFile(schemaUrl, token);
}

export async function deleteMessage(tableId, messageId, token=TOKEN) {
    await fetch(`https://discord.com/api/v10/channels/${tableId}/messages/${messageId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bot ${token}`,
            'User-Agent': 'DiscordBot (https://somefakewebsite.com, 1)'
        }
    });
}

export async function getFile(url, token=TOKEN) {
    const func = async () => await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bot ${token}`,
            'User-Agent': 'DiscordBot (https://somefakewebsite.com, 1)'
        }
    });
    const response = await rateLimit(func, true);
    const blob = await response.blob();
    return JSON.parse(await blob.text());
}

function makeId(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}

export async function postFile(channelId, message, fileName, token=TOKEN) {
    const formData = new FormData();
    formData.append(fileName, new Blob([message], { type: 'text/plain' }), fileName);
    const func = async () => await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${token}`,
            'User-Agent': 'DiscordBot (https://somefakewebsite.com, 1)'
        },
        body: formData,
    });
    return await (await rateLimit(func));
}

export async function postMessage(channelId, message, token=TOKEN) {
    if (message.length > 1950) {
        console.error("Message length exceeds discord's maximum message length of 2000 characters")
    }
    return await fetchPost(`https://discord.com/api/v10/channels/${channelId}/messages`, { content: message }, token);
}

let stopRequest = false;
let limitResetUnix = 0;

async function rateLimit(func, returnRaw = false) {
    if (stopRequest) {
        const unixTime = Date.now() / 1000;
        if (limitResetUnix > unixTime) {
            await sleep((limitResetUnix - unixTime) * 1000);
        }
    }

    const response = await func();
    if (Number(response.headers.get('x-ratelimit-remaining')) === 0) {
        stopRequest = true;
        limitResetUnix = Number(response.headers.get('x-ratelimit-reset'));
    } else {
        stopRequest = false;
    }

    let resp = returnRaw ? response : await response.json();
    if (resp.retry_after !== undefined) {
        await sleep(resp.retry_after * 1000);
        return await rateLimit(func, returnRaw);
    } else {
        return resp;
    }
}

export async function fetchPatch(url, data, token=TOKEN) {
    const func = async () => await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bot ${token}`,
            'User-Agent': 'DiscordBot (https://somefakewebsite.com, 1)',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    return await rateLimit(func);
}

export async function fetchGet(url, token=TOKEN) {
    const func = async () => await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bot ${token}`,
            'User-Agent': 'DiscordBot (https://somefakewebsite.com, 1)'
        }
    });

    return await rateLimit(func);
}

export async function fetchPost(url, data, token=TOKEN) {
    const func = async () => await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${token}`,
            'User-Agent': 'DiscordBot (https://somefakewebsite.com, 1)',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    return await rateLimit(func)
}

function sleep(timeout) {
    return new Promise((resolve) => setTimeout(resolve, timeout));
}