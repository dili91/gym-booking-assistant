const logging = require('./logging.js');
const axios = require('axios');

axios.interceptors.request.use(request => {
    logging.debug(`>>> ${request.method.toUpperCase()} ${request.url}\n${JSON.stringify(request.data,null, 2)}`)
    return request
})

axios.interceptors.response.use(response => {
    logging.debug(`<<< ${response.status} ${response.request.method.toUpperCase()} ${response.request.url}\n${JSON.stringify(response.data,null, 2)}\n\n`)
    return response
})

axios.defaults.headers.common['x-mwapps-client'] = getEnvVariable('CLIENT_ID');

const CORE_API_BASE_URI = 'https://services.mywellness.com';

function getEnvVariable(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable ${name} is not defined`);
    }
    return value;
}

function isResponseError(response){
    return response.status < 200 || response.status >= 300
        || (response.data != null && response.data.errors !=null)
}

exports.handler = async (event) => {

    let loginResponse = await axios.post(`${CORE_API_BASE_URI}/Application/${getEnvVariable('APPLICATION_ID')}/Login`,
    {
        "domain": "it.virginactive",
        "keepMeLoggedIn": true,
        "password": getEnvVariable('LOGIN_PASSWORD'),
        "username": getEnvVariable('LOGIN_USERNAME')
    });

    if(isResponseError(loginResponse)){
        logging.error("Unable to login. stopping")
        process.exit(1);
    }

    logging.info(loginResponse.data.token)
};