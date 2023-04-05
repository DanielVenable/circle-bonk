import { createHash, randomBytes } from 'crypto';
import { promisify } from 'util';

const random = promisify(randomBytes);

export async function sign(head, body_size = 10, hash_size = 1) {
	const body = (await random(body_size))
		.toString('base64')
		.slice(0, body_size)
		.replace(/[/]/g, '_')
		.replace(/[+]/g, '-');
	return head + '-' + body + get_hash(head, body, hash_size);
}
export function verify(key, body_size = 10, hash_size = 1) {
	const head = key.slice(0, -hash_size - body_size - 1), body = key.slice(-hash_size - body_size, -hash_size), hash = key.slice(-hash_size);
	return get_hash(head, body, hash_size) === hash ? head : undefined;
}

function get_hash(head, body, hash_size) {
	return createHash('shake256', { outputLength: hash_size })
		.update(head + body + process.env.SECRET_KEY)
		.digest('base64')
		.slice(0, hash_size)
		.replace(/[/]/g, '-');
}