import * as dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import Client from "./index";

dotenv.config();

const client = new Client({
  apiKey: process.env.API_KEY ?? "",
  apiSecret: process.env.API_SECRET ?? "",
  apiUrlPrefix:
    process.env.API_ENDPOINT ?? "https://addons.mozilla.org/api/v5/",
});

const argv = await yargs(hideBin(process.argv))
  .command(["addon", "$0"], "submit a new add-on", {
    xpi: {
      alias: ["x", "f", "file"],
      type: "string",
      demandOption: true,
      requiresArg: true,
      description: "Filename/path of add-on file to be submitted.",
    },
    channel: {
      alias: "c",
      type: "string",
      demandOption: true,
      requiresArg: true,
      choices: ["listed", "unlisted"] as const,
      description: "Version release channel",
    },
    data: {
      alias: ["d", "json"],
      type: "string",
      default: "{}",
      requiresArg: true,
      description: "A JSON string of extra metadata for the new addon/version.",
      coerce: (data) => JSON.parse(data),
    },
  })
  .command(["version"], "submit a new version", {
    addonId: {
      alias: ["id", "guid"],
      type: "string",
      demandOption: true,
      requiresArg: true,
      description: "The add-on id (slug|amo-numeric-id|guid)",
    },
    xpi: {
      alias: ["x", "f", "file"],
      type: "string",
      demandOption: true,
      requiresArg: true,
      description: "Filename/path of add-on file to be submitted.",
    },
    channel: {
      alias: "c",
      type: "string",
      demandOption: true,
      requiresArg: true,
      choices: ["listed", "unlisted"] as const,
      description: "Version release channel",
    },
    data: {
      alias: ["d", "json"],
      type: "string",
      default: "{}",
      requiresArg: true,
      description: "A JSON string of extra metadata for the new addon/version.",
      coerce: (data) => JSON.parse(data),
    },
  })
  .command(["download-latest"], "download the latest version of an add-on", {
    addonId: {
      alias: ["id", "guid"],
      type: "string",
      demandOption: true,
      requiresArg: true,
      description: "The add-on id (slug|amo-numeric-id|guid)",
    },
  }).argv;

if (argv._.includes("addon")) {
  await client.submitAddon(String(argv.xpi), String(argv.channel), argv.data);
} else if (argv._.includes("version")) {
  await client.submitVersion(
    String(argv.xpi),
    String(argv.channel),
    String(argv.addonId),
    argv.data
  );
} else if (argv._.includes("download-latest")) {
  await client.downloadLatestVersion(String(argv.addonId));
}

console.log("Done!");
