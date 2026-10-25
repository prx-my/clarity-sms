import dotenv from 'dotenv';
import { productionEnvironmentReport } from '../src/lib/ai/deployment';
// Optional file must be explicitly chosen. Never silently use local demo settings.
if (process.env.ENV_FILE) dotenv.config({ path: process.env.ENV_FILE, quiet: true });
const report = productionEnvironmentReport();
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
