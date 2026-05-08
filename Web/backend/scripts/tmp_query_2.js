const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
    const outputs = await prisma.tb_output_actual.findMany({
        where: { date: new Date("2026-03-24T00:00:00.000Z") }
    });
    console.log("Output Data:", JSON.stringify(outputs, null, 2));
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
