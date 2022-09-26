import * as t from 'io-ts';
import dotenv from 'dotenv';


const EnvironmentCodec = t.type({
  NODE_ENV: t.string
});
export type Environment = t.TypeOf<typeof EnvironmentCodec>;
export let environment: Environment;

export function setupEnvironment() {
  dotenv.config();
  const decoded = EnvironmentCodec.decode(process.env);

  if (decoded._tag === 'Left') {
    for (let error of decoded.left) {
      const path = error.context.map(node => node.key).join('/');
      console.warn(`Invalid environment variable: ${path}: (actual: ${(error.value as any)?.toString()}, expected: ${error.context[error.context.length - 1].type.name})`);
    }
    throw new Error('Invalid environment variables! see above warnings for details');
  }
  environment = process.env as Environment;
}
