#!/usr/bin/env node

import path from "node:path";
import dotenv from "dotenv";
import { runCli } from "../dist/cli.js";

const cwd = process.cwd();
dotenv.config({ path: path.join(cwd, ".env"), override: false });
dotenv.config({ path: path.join(cwd, ".env.local"), override: true });

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
