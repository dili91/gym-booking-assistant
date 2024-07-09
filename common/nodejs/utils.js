const {
  GetSecretValueCommand,
  SecretsManagerClient,
} = require("@aws-sdk/client-secrets-manager");

const moment = require("moment-timezone");
const secretsManagerClient = new SecretsManagerClient();

const CET_TIMEZONE = "Europe/Rome";

// Holds the JSON secret returned by the AWS secret manager
let secret = null;

module.exports = {
  getEnvVariable: (name) => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Environment variable ${name} is not defined`);
    }
    return value;
  },

  getSecret: async (name) => {
    if (!secret) {
      const secretValue = await secretsManagerClient.send(
        new GetSecretValueCommand({
          SecretId: "GymBookingAssistant",
        }),
      );

      secret = JSON.parse(secretValue.SecretString);
    }

    const value = secret[name];
    if (!value) {
      throw new Error(`Secret ${name} not found.`);
    }

    return value;
  },

  truncateString: (str, num) => {
    if (str.length > num) {
      return str.slice(0, num) + "...";
    } else {
      return str;
    }
  },

  stringToDateCET: (dateStr) => {
    const timezoneRegex = /Z|[+-]\d{2}:\d{2}|[+-]\d{4}|[A-Z]{3}/;
    if (timezoneRegex.test(dateStr)) {
      throw Error("Input date string should not contain timezone info!");
    }

    return moment.tz(dateStr, CET_TIMEZONE);
  },

  nowCET: () => {
    return moment.tz(CET_TIMEZONE);
  },
};
