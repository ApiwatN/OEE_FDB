const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
    const oees = await prisma.tb_oee.findMany({
        where: { date: new Date("2026-03-24T00:00:00.000Z") }
    });
    console.log("OEE Data:", JSON.stringify(oees, null, 2));
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
