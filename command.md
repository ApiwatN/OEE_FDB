fontend setting
npx create-next-app@latest .
npm install axios bootstrap chart.js chartjs-plugin-datalabels next react react-chartjs-2 react-dom sweetalert2
npm install -D @types/bootstrap @types/node @types/react @types/react-dom eslint eslint-config-next typescript

copy dist plugin >>> publish

backend setting
npm init
npm install @prisma/client body-parser cors dayjs dotenv express express-fileupload jsonwebtoken && npm install -D @types/node prisma ts-node typescript
npx tsc --init
npm i prisma --save-dev
npx prisma init --datasource-provider sqlserver

//migrate
npx prisma migrate dev --name newModel

mkdir prisma\migrations\000_init
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/000_init/migration.sql
npx prisma migrate resolve --applied 000_init
npx prisma migrate dev --name add_new_field

Deploy
fontend
ติดตั้ง IIS (Internet Information Services)
cd E:\OEE\frontend
npm install
npm run build
npm run start
pm2 start npm --name "oee-frontend" -- start

backend

- ติดตั้ง pm2 แบบ global
  npm install pm2 -g
  cd E:\OEE\backend
  npm install

pm2 start server.js --name "oee-backend"
pm2 save
pm2 startup
npm run start

npm install pm2-windows-startup -g
pm2-startup uninstall
