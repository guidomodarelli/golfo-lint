#!/usr/bin/env node
/** @module bin/golfo-lint `golfo-lint <análisis> [argumentos...]`: runs one code quality check. */
import process from "node:process";
import { runCli } from "../src/cli/run-cli.js";

process.exitCode = await runCli(process.argv.slice(2));
