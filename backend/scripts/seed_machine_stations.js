const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding tbm_machine_station...');

  const baseStations = [
    { ng_id: 1, station_number: 3, station_name: 'St#3 Bottom Hub ECM & OD Sleeve' },
    { ng_id: 2, station_number: 5, station_name: 'St#5 ID Bottom' },
    { ng_id: 3, station_number: 7, station_name: 'St#7 ID Top' },
    { ng_id: 4, station_number: 9, station_name: 'St#9 ECM Conical Groove Top & Bottom' },
    { ng_id: 5, station_number: 11, station_name: 'St#11 Top HUB & OD Hub' },
  ];

  const machines = ['AHV-001', 'AHV-002', 'AHV-003', 'AHV-004', 'AHV-005', 'AHV-006'];
  const stations = [];

  for (const mName of machines) {
    for (const bSt of baseStations) {
        stations.push({
            machine_name: mName,
            ...bSt
        });
    }
  }

  for (const st of stations) {
    const existing = await prisma.tbm_machine_station.findFirst({
      where: {
        machine_name: st.machine_name,
        ng_id: st.ng_id
      }
    });

    if (existing) {
      await prisma.tbm_machine_station.update({
        where: { id: existing.id },
        data: st
      });
      console.log(`Updated: ${st.machine_name} - ${st.station_name}`);
    } else {
      await prisma.tbm_machine_station.create({
        data: st
      });
      console.log(`Created: ${st.machine_name} - ${st.station_name}`);
    }
  }

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
