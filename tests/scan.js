var sinon = require("sinon");
var scan = require("../index");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

describe("Scan classes", function () {
  beforeEach(() => {
    const secretsManagerStub = sinon.stub(
      SecretsManagerClient.prototype,
      "send",
    );

    secretsManagerStub
      .withArgs(
        sinon.match
          .instanceOf(GetSecretValueCommand)
          // TODO: Can this be simplified?
          .and(
            sinon.match(function (value) {
              return value.input.SecretId == "GymBookingAssistant";
            }),
          ),
      )
      .returns({
        applicationId: process.env["APPLICATION_ID"],
        facilityId: process.env["FACILITY_ID"],
        clientId: process.env["CLIENT_ID"],
        // TODO: structure this a bit more
        loginUsername: process.env["LOGIN_USERNAME"],
        loginPassword: process.env["LOGIN_PASSWORD"],
        loginDomain: process.env["LOGIN_DOMAIN"],
      });

    afterEach(() => secretsManagerStub.restore());
  });

  it("It should find a class and publish a class available event", async function () {
    await scan.handler();
  });
});
