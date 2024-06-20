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
};
