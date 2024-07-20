const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");

var utils = require("/opt/nodejs/utils");
var logging = require("/opt/nodejs/logging");
var gymApiClient = require("/opt/nodejs/gymApiClient");
const { expect } = require("chai");

describe("Gym API client", function () {
  let getSecretStub;

  afterEach(() => {
    sandbox.restore();
  });

  beforeEach(() => {
    // Stub interactions with secrets
    getSecretStub = sandbox.stub(utils, "getSecret");
  });

  describe("Login", function () {
    let genericHttpClientStub;

    beforeEach(() => {
      // Stub HTTP client
      let httpClientFake = gymApiClient.getHttpClient();
      httpClientFake.interceptors.request.handlers = [];
      genericHttpClientStub = sandbox.stub(httpClientFake, "request");

      // Stub internal client
      utilsStub = sandbox
        .stub(gymApiClient, "getHttpClient")
        .returns(httpClientFake);
    });

    it("Should yield a token in case of successful login", async function () {
      // Arrange
      let applicationId = uuidv4();
      let loginDomain = uuidv4();
      let token = uuidv4();

      getSecretStub.withArgs("applicationId").returns(applicationId);
      getSecretStub.withArgs("loginDomain").returns(loginDomain);

      genericHttpClientStub
        .withArgs(
          sandbox.match(function (request) {
            return request.method == "POST" && request.url.endsWith("/Login");
          }),
        )
        .returns({
          status: 200,
          data: {
            token: token,
          },
        });

      // Act
      let username = "jdoe@gmail.com";
      let password = uuidv4();
      let loginData = await gymApiClient.login(username, password);

      // Assert
      sandbox.assert.calledTwice(getSecretStub);
      expect(getSecretStub.getCall(0).args[0]).to.equal("applicationId");
      expect(getSecretStub.getCall(0).returnValue).to.equal(applicationId);
      expect(getSecretStub.getCall(1).args[0]).to.equal("loginDomain");
      expect(getSecretStub.getCall(1).returnValue).to.equal(loginDomain);

      sandbox.assert.calledOnceWithMatch(
        genericHttpClientStub,
        sandbox.match(function (request) {
          return (
            request.method == "POST" &&
            request.url.endsWith("/Login") &&
            request.data.username == username &&
            request.data.password == password
          );
        }),
      );

      expect(loginData.token).to.equal(token);
    });

    it("Should exit in case of unsuccessful login", async function () {
      // Arrange
      processStub = sandbox.stub(process, "exit");

      let applicationId = uuidv4();
      let loginDomain = uuidv4();

      getSecretStub.withArgs("applicationId").returns(applicationId);
      getSecretStub.withArgs("loginDomain").returns(loginDomain);

      genericHttpClientStub
        .withArgs(
          sandbox.match(function (request) {
            return request.method == "POST" && request.url.endsWith("/Login");
          }),
        )
        .returns({
          status: 200,
          data: {
            errors: [
              {
                field: "EntityId",
                type: "ErrorCode",
                details: "EntityIdNotValid",
                message: "ErrorCode",
              },
            ],
          },
        });

      // Act
      let username = "jdoe@gmail.com";
      let password = uuidv4();
      await gymApiClient.login(username, password);

      // Assert
      expect(process.exit.calledOnce);
      expect(process.exit.getCall(0).args[0]).to.equal(1);
    });
  });

  describe("Get Http client", function () {
    describe("Utils", function () {
      it("It should yield an HTTP client", async function () {
        let client = gymApiClient.getHttpClient();

        expect(client).to.be.not.null;
        expect(client.interceptors.request.handlers).to.have.lengthOf(2);
        expect(client.interceptors.response.handlers).to.have.lengthOf(1);
      });

      it("It should include the x-mwapps-client header", async function () {
        // Arrange
        let clientId = uuidv4();
        getSecretStub.withArgs("clientId").returns(clientId);
        let client = gymApiClient.getHttpClient();
        sandbox.spy(client, "request");

        // Act
        await client.request({
          method: "GET",
          url: "https://google.com",
        });

        // Assert
        expect(client.request.calledOnce).to.be.true;
        const headers = (await client.request.getCall(0).returnValue).request
          ._header;
        expect(headers).to.contain(`x-mwapps-client: ${clientId}`);
      });

      it("It should log request and response", async function () {
        // Arrange
        const method = "GET";
        const url = "https://google.com";
        sandbox.spy(logging, "debug");

        const client = gymApiClient.getHttpClient();

        // Act
        await client.request({
          method: method,
          url: url,
        });

        // Assert
        expect(logging.debug.calledTwice).to.be.true;
        expect(logging.debug.getCall(0).args[0])
          .to.be.a("string")
          .and.satisfy((msg) => msg.startsWith(`>>> ${method} ${url}`));
        expect(logging.debug.getCall(1).args[0])
          .to.be.a("string")
          .and.satisfy(
            (msg) => msg.startsWith("<<<") && msg.includes(`${method} ${url}`),
          );
      });
    });
  });
});
