const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = {
  listModel: async (req, res) => {
    try {
      const models = await prisma.tbm_model.findMany({
        where: { status: "active" }, // หรือเงื่อนไขตามที่คุณต้องการ
        orderBy: { model_name: "asc" },
      });
      res.json({ results: models });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Error fetching models" });
    }
  },

  listModelType: async (req, res) => {
    try {
      const types = await prisma.tbm_model_type.findMany({
        where: { status: "active" },
        orderBy: { model_type: "asc" },
      });
      res.json({ results: types });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Error fetching model types" });
    }
  },
};