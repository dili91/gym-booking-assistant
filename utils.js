const {
  GetSecretValueCommand,
  SecretsManagerClient,
} = require("@aws-sdk/client-secrets-manager");

const client = new SecretsManagerClient();

module.exports = {
  getEnvVariable: (name) => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Environment variable ${name} is not defined`);
    }
    return value;
  },

  isResponseError: (response) => {
    return (
      response.status < 200 ||
      response.status >= 300 ||
      (response.data != null && response.data.errors != null)
    );
  },

  getSecret: async (name) => {
    const secret = await client.send(
      new GetSecretValueCommand({
        SecretId: "GymBookingAssistant",
      }),
    );

    const value = secret[name];
    if (!value) {
      throw new Error(`Secret ${name} not found.`);
    }

    return value;
  },
};
