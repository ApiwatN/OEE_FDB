const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function fixOEE() {
    const targetDate = new Date("2026-03-24T00:00:00.000Z");
    const oees = await prisma.tb_oee.findMany({ where: { date: targetDate } });
    const outputs = await prisma.tb_output_actual.findMany({ where: { date: targetDate } });
    
    for(const oee of oees) {
        const out = outputs.find(o => o.machine_name === oee.machine_name);
        const total = out ? (out.Overall || 0) : 0;
        const ng = oee.ng_qty || 0;
        
        let quality = 0;
        if (total > 0) {
            quality = ((total - ng) / total) * 100;
            if (quality < 0) quality = 0;
        }
        
        let oeeVal = 0;
        if (oee.availability > 0 && oee.performance > 0 && quality > 0) {
            oeeVal = (oee.availability / 100) * (oee.performance / 100) * (quality / 100) * 100;
        }
        
        await prisma.tb_oee.update({
            where: { id: oee.id },
            data: {
                quality: parseFloat(quality.toFixed(2)),
                oee_value: parseFloat(oeeVal.toFixed(2))
            }
        });
        console.log(`Fixed ${oee.machine_name}: Qty=${quality.toFixed(2)}% OEE=${oeeVal.toFixed(2)}%`);
    }
}
fixOEE().then(() => {
    console.log("Done");
    process.exit(0);
});
