const sandbox = require("sinon").createSandbox();
const { v4: uuidv4 } = require("uuid");

var utils = require("/opt/nodejs/utils");
var logging = require("/opt/nodejs/logging");
var gymApiClient = require("/opt/nodejs/gymApiClient");
const { expect } = require("chai");

describe("Gym API client", function () {
  let getConfigStub;

  afterEach(() => {
    sandbox.restore();
  });

  beforeEach(() => {
    // Stub interactions with user credentials and config
    getUserCredentialsStub = sandbox.stub(utils, "getUserCredentials");
    getConfigStub = sandbox.stub(utils, "getConfig");
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

      getConfigStub.withArgs("applicationId").returns(applicationId);
      getConfigStub.withArgs("loginDomain").returns(loginDomain);

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
      sandbox.assert.calledTwice(getConfigStub);
      expect(getConfigStub.getCall(0).args[0]).to.equal("applicationId");
      expect(getConfigStub.getCall(0).returnValue).to.equal(applicationId);
      expect(getConfigStub.getCall(1).args[0]).to.equal("loginDomain");
      expect(getConfigStub.getCall(1).returnValue).to.equal(loginDomain);

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
      let applicationId = uuidv4();
      let loginDomain = uuidv4();

      getConfigStub.withArgs("applicationId").returns(applicationId);
      getConfigStub.withArgs("loginDomain").returns(loginDomain);

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

      try {
        // Act
        await gymApiClient.login(username, password);
      } catch(error) {
          // Assert
          expect(error).to.be.an('error');
          expect(error.name).to.be.equal('Error');
          expect(error.message).to.be.equal('Received even without userAlias. Aborting');
      }
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
        getConfigStub.withArgs("clientId").returns(clientId);
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
