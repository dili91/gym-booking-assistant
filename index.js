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
axios.defaults.headers.common['Content-Type'] = 'application/json';

const CORE_API_BASE_URI = 'https://services.mywellness.com';
const CALENDAR_API_BASE_URI = 'https://calendar.mywellness.com/v2';

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

    // First of all login
    var loginRequest = {
        method: 'POST',
        url: `${CORE_API_BASE_URI}/Application/${getEnvVariable('APPLICATION_ID')}/Login`,
        data: {
            domain: 'it.virginactive',
            keepMeLoggedIn: true,
            password: getEnvVariable('LOGIN_PASSWORD'),
            username: getEnvVariable('LOGIN_USERNAME')
        }
    }

    let loginResponse = await axios.request(loginRequest);

    if(isResponseError(loginResponse)){
        logging.error("Unable to login. stopping")
        process.exit(1);
    }

    // Search all classes that match my criteria of interest
    let searchClassesRequest = {
        method: 'GET',
        url: `${CALENDAR_API_BASE_URI}/enduser/class/search`,
        params: {
            facilityId: getEnvVariable('FACILITY_ID'),
            toDate: '20240611',
            fromDate: '20240611',
            eventType: 'Class'
        },
    }
    let searchClassesResponse = await axios.request(searchClassesRequest);

    if(isResponseError(searchClassesResponse)){
        logging.error("Unable to get classes. stopping")
        process.exit(1);
    }

    logging.info(`Found ${searchClassesResponse.data.length} classes.`)
};