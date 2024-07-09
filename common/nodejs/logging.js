const chalk = import("chalk").then((m) => m.default);

const error = async (msg) => {
  console.error((await chalk).red.bold(msg));
};

const warn = async (msg) => {
  console.warn((await chalk).bold.yellow(msg));
};

const info = async (msg) => {
  console.info((await chalk).blue(msg));
};

const debug = async (msg) => {
  console.debug((await chalk).dim.blackBright(msg));
};

module.exports = { error, warn, info, debug };
