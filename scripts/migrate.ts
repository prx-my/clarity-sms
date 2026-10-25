import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
async function main(){
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL before applying migrations');
await migrate(drizzle(neon(process.env.DATABASE_URL)),{migrationsFolder:'drizzle'});
console.log('Database migrations applied. No calls placed or routing changed.');

}
void main().catch(()=>{console.error('Database migration failed; check connectivity and migration history.');process.exitCode=1;});
