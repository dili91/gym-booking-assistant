var sinon = require("sinon");
var expect = require("chai").expect;

var utils = require("/opt/nodejs/utils");
const logging = require("/opt/nodejs/logging.js");

const { v4: uuidv4 } = require("uuid");

describe("Utils", function () {
  it("It should yield an HTTP client", async function () {
    let client = utils.getHttpClient();

    expect(client).to.be.not.null;
    expect(client.interceptors.request.handlers).to.have.lengthOf(2);
    expect(client.interceptors.response.handlers).to.have.lengthOf(1);
  });

  it("It should include the x-mwapps-client header", async function () {
    // Arrange
    let clientId = uuidv4();
    sinon.stub(utils, "getSecret").withArgs("clientId").returns(clientId);
    let client = utils.getHttpClient();
    sinon.spy(client, "request");

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
    sinon.spy(logging, "debug");

    const client = utils.getHttpClient();

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
