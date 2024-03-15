const AWS = require('aws-sdk')
AWS.config.update({ region: 'eu-west-2' })
const cognito = new AWS.CognitoIdentityServiceProvider()
const UserPoolId = 'YourUserPoolId'

async function listUnverifiedUsers() {
	let unverifiedUsers = []
	let paginationToken = null
	let counter = 0
	let lastCounter = 0
	do {
		if (lastCounter < counter) {
			lastCounter = counter
			console.log('counter', counter)
		}

		const users = await cognito
			.listUsers({
				UserPoolId: UserPoolId,
				PaginationToken: paginationToken,
			})
			.promise()

		const currentPageUnverifiedUsers = users.Users.filter((user) => {
			let emailUnverified = false
			emailUnverified = user.Attributes.find((attribute) => attribute.Name === 'email_verified') || true
			if (emailUnverified.Value === 'true') {
				emailUnverified = false
			}
			if (emailUnverified === true) {
				updateUnverifiedUsers(user)
				counter += 1
			}

			return emailUnverified
		})

		unverifiedUsers = [...unverifiedUsers, ...currentPageUnverifiedUsers]
		paginationToken = users.PaginationToken
	} while (paginationToken)
	let totalUnverifiedUsers = unverifiedUsers.length
	return totalUnverifiedUsers
}

async function updateUnverifiedUsers(user) {
	const params = {
		UserPoolId: UserPoolId,
		Username: user.Username,
		UserAttributes: [
			{
				Name: 'email_verified',
				Value: 'true',
			},
		],
	}
	return cognito.adminUpdateUserAttributes(params).promise()
}

listUnverifiedUsers().then((totalUnverifiedUsers) => {
	console.log(`total - ${totalUnverifiedUsers}`)
})
