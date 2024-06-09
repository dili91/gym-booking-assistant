set dotenv-load := true

alias r := run

run:
    APPLICATION_ID=ec1d38d7-d359-48d0-a60c-d8c0b8fb9df9 \
    FACILITY_ID=b65351c6-02b4-4e62-9d8c-416e17b9b6fe \
    CLIENT_ID=mywellnessappios40 \
    node -e "require('./index.js').handler();"

format: 
    npx prettier . --write 