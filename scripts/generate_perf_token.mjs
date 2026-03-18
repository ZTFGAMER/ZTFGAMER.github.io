import { randomBytes } from 'node:crypto'

const token = randomBytes(24).toString('base64url')
console.log(token)
