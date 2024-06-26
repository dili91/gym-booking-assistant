const {
  GetSecretValueCommand,
  SecretsManagerClient,
} = require("@aws-sdk/client-secrets-manager");

const secretsManagerClient = new SecretsManagerClient();

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

  isResponseError: (response) => {
    return (
      response.status < 200 ||
      response.status >= 300 ||
      (response.data != null && response.data.errors != null)
    );
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
};
