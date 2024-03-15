const { execSync } = require('child_process')
const AWS = require('aws-sdk')
const fs = require('fs')
const axios = require('axios')
import {localConfig} from './localvars.json'

const QUEUE_URL = localConfig.queueURL
const BATCH_SIZE = 10
const MESSAGE_TIMEOUT = 300 //Need to adjust timeout so you have enough time to work the whole list before it rejoins the list because we're not deleting the messages
const OUTPUT_FILE = 'dlqDynamoChecks.csv'
const AWS_COMMAND = `aws sqs receive-message --queue-url ${QUEUE_URL} --visibility-timeout ${MESSAGE_TIMEOUT} --max-number-of-messages ${BATCH_SIZE} --query 'Messages[*].Body' --output json --no-paginate`

AWS.config.update({ region: 'eu-west-2' })
const ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' })
const secretsManager = new AWS.SecretsManager()

async function retrieveAndSaveMessages() {
	//Set up OMS Client
	let omsConfig = await setBomsConfig()
	omsConfig.baseURL = `${omsConfig.baseURL}/v1`
	let omsClient = await createOmsClient(omsConfig)

	while (true) {
		// Retrieve messages from the queue
		let messages
		try {
			messages = execSync(AWS_COMMAND).toString()
		} catch (error) {
			console.error('Error retrieving messages:', error.message)
			return
		}

		// Check if there are no more messages or if messages is null
		if (!messages.trim() || messages.trim() === 'null') {
			console.log('No more messages in the queue.')
			break
		}

		// Process each message
		const messageArray = JSON.parse(messages)
		for (let message of messageArray) {
			let jsonMessage = JSON.parse(message)
			if (jsonMessage) {
				const orderNumber = jsonMessage.detail.dynamodb.Keys.orderNumber.S
				if (orderNumber) {
					let bomsOrderStatus = await checkOrderInBoms(orderNumber, omsConfig, omsClient)
					let dynamoOrderStatus = await checkOrderInDynamo(orderNumber)
					fs.appendFileSync(OUTPUT_FILE, JSON.stringify(orderNumber) + ',' + dynamoOrderStatus + ',' + bomsOrderStatus + '\n')
				}
			}
		}
	}
}

async function checkOrderInDynamo(orderNumber) {
	try {
		// Call the DynamoDB API to check if the order exists
		let queryParams = dynamoParams(orderNumber)
		let data = await ddb.query(queryParams).promise()
		if (data.Items.length === 0) {
			return 'Order not found in Dynamo'
		} else {
			return data.Items[0].status.S
		}
	} catch (error) {
		console.error('Error checking order in Dynamo:', error.message)
		return 'Error checking order in Dynamo'
	}
}

const dynamoParams = (orderNumber) => {
	let params = {
		TableName: localConfig.dynamoTableName, // replace 'TABLE_NAME' with your table name
		KeyConditionExpression: 'orderNumber = :pk and sk = :sk', // replace 'PK' and 'SK' with your key names
		ExpressionAttributeValues: {
			':pk': { S: orderNumber }, // replace 'PARTITION_KEY_VALUE' with your key value
			':sk': { S: 'order' }, // replace 'SORT_KEY_VALUE' with your sort key value
		},
	}
	return params
}

async function checkOrderInBoms(orderNumber, omsConfig, omsClient) {
	try {
		let omsOrder = await getOrderByNumber(orderNumber, omsConfig, omsClient)
		return omsOrder
	} catch (error) {
		console.error('Error checking order in BOMS:', error.message)
		return 'Error checking order in BOMS'
	}
}

async function getOrderByNumber(orderNumber, config, omsClient) {
	const path = `/orderdetails/${orderNumber}?id=ordernumber`

	// const client = await createOmsClient(config)
	const response = await (await omsClient.get(path)).data

	if (response?.response === 'Could not find order by this order number.') {
		return 'Not found'
	}
	return response[0].status
}

async function setBomsConfig() {
	try {
		const data = await secretsManager.getSecretValue({ SecretId: localConfig.bomsSecretId }).promise()
		return JSON.parse(data.SecretString)
	} catch (err) {
		console.error(err)
	}
}

async function createOmsClient(config) {
	return {
		get: (path) => {
			return axios.get(`${config.baseURL}${path}`, {
				auth: {
					username: config.username,
					password: config.password,
				},
			})
		},
	}
}

// Clear existing output file or create new if not exists
fs.writeFileSync(OUTPUT_FILE, '')

retrieveAndSaveMessages()
