const chalk = import("chalk").then((m) => m.default);

const error = async (msg) => {
  console.log((await chalk).red.bold(msg));
};

const warn = async (msg) => {
  console.log((await chalk.bold).yellow(msg));
};

const info = async (msg) => {
  console.log((await chalk).blue(msg));
};

const debug = async (msg) => {
  console.log((await chalk).dim.blackBright(msg));
};

module.exports = { error, warn, info, debug };
