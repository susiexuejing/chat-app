// Standalone private operator entry. Never import index.ts or start the server.
import { runEf385DevResultOperator } from './ef385DevResultDiagnostic';

const ok = runEf385DevResultOperator(process.argv.slice(2), text => process.stdout.write(`${text}\n`));
// Success is silent except a validated read-clear receipt. Failure is silent too.
process.exitCode = ok ? 0 : 1;
