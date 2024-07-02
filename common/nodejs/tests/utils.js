var sinon = require("sinon");
var expect = require("chai").expect;

const utils = require("/opt/nodejs/utils");

describe("Utils", function () {
  it("It should yield an HTTP client", async function () {
    let client = utils.getHttpClient();

    expect(client).to.be.not.null;
    expect(client.interceptors.request.handlers).to.have.lengthOf(2);
    expect(client.interceptors.response.handlers).to.have.lengthOf(1);
  });

  it("It should include the x-mwapps-client header", async function () {
    //TODO
    throw new Error("Not implemented");
  });

  it("It should log request and response", async function () {
    //TODO
    throw new Error("Not implemented");
  });
});
