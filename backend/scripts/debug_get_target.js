const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    try {
        const target = await prisma.tb_output_target.findFirst({
            orderBy: { id: 'desc' }
        });
        if (target) {
            console.log("FOUND_ID:" + target.id);
        } else {
            console.log("NO_TARGET_FOUND");
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
