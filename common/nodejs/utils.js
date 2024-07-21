const {
  GetSecretValueCommand,
  SecretsManagerClient,
} = require("@aws-sdk/client-secrets-manager");
const secretsManagerClient = new SecretsManagerClient();

const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const serviceSystemManagerClient = new SSMClient();

const moment = require("moment-timezone");

const CET_TIMEZONE = "Europe/Rome";

// Holds the JSON config returned by the AWS config manager
let config = null;

module.exports = {
  /**
   * Utility to fetch a config value
   * 
   * @param {*} name of the config to lookup 
   */
  getConfig: async (name) => {
    if(!config){
      const parametersStoreResponse = await serviceSystemManagerClient.send(new GetParameterCommand("GymBookingAssistant"));
      config = JSON.parse(parametersStoreResponse.Parameter.Value)
    }

    const value = config[name];
    if (!value) {
      throw new Error(`Config "${name}" not found.`);
    }

    return value;
  },

  /**
   * Utility to fetch user's credentials
   * 
   * @param {*} userAlias the user alias to which the secret belongs
   * @returns a JSON representation of the user credentials
   */
  getUserCredentials: async (userAlias) => {
    const credentials = await secretsManagerClient.send(
      new GetSecretValueCommand({
        SecretId: `GymBookingAssistant_Credentials_${userAlias}`,
      }),
    );

    return JSON.parse(credentials.SecretString);
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
