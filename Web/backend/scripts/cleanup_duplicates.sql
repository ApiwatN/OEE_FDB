-- ============================================================
-- Script: ลบแถวซ้ำในตาราง OEE (เก็บเฉพาะ row ที่มี id สูงสุด)
-- ============================================================

-- 1. ตรวจสอบแถวซ้ำก่อนลบ
SELECT 'tb_output_actual' AS [Table], machine_name, date, COUNT(*) AS cnt
FROM dbo.tb_output_actual
GROUP BY machine_name, date
HAVING COUNT(*) > 1;

SELECT 'tb_cycle_time_actual' AS [Table], machine_name, date, COUNT(*) AS cnt
FROM dbo.tb_cycle_time_actual
GROUP BY machine_name, date
HAVING COUNT(*) > 1;

SELECT 'tb_efficiency_actual' AS [Table], machine_name, date, COUNT(*) AS cnt
FROM dbo.tb_efficiency_actual
GROUP BY machine_name, date
HAVING COUNT(*) > 1;

-- 2. ลบแถวซ้ำ — เก็บ row ที่มี id สูงสุด (ข้อมูลใหม่สุด)
DELETE FROM dbo.tb_output_actual
WHERE id NOT IN (
    SELECT MAX(id) FROM dbo.tb_output_actual GROUP BY machine_name, date
);

DELETE FROM dbo.tb_cycle_time_actual
WHERE id NOT IN (
    SELECT MAX(id) FROM dbo.tb_cycle_time_actual GROUP BY machine_name, date
);

DELETE FROM dbo.tb_efficiency_actual
WHERE id NOT IN (
    SELECT MAX(id) FROM dbo.tb_efficiency_actual GROUP BY machine_name, date
);

-- 3. ตรวจสอบหลังลบ (ควรไม่มีแถวซ้ำแล้ว)
SELECT 'tb_output_actual' AS [Table], COUNT(*) AS total_rows FROM dbo.tb_output_actual;
SELECT 'tb_cycle_time_actual' AS [Table], COUNT(*) AS total_rows FROM dbo.tb_cycle_time_actual;
SELECT 'tb_efficiency_actual' AS [Table], COUNT(*) AS total_rows FROM dbo.tb_efficiency_actual;

-- 4. เพิ่ม Unique Constraint (หลังลบแถวซ้ำแล้ว)
-- Note: ผม recommend ให้ทำผ่าน Prisma schema แทน เพื่อให้ sync กัน
-- แต่ถ้าต้องการรัน SQL ตรงๆ:
-- ALTER TABLE dbo.tb_output_actual ADD CONSTRAINT UQ_output_machine_date UNIQUE (machine_name, date);
-- ALTER TABLE dbo.tb_cycle_time_actual ADD CONSTRAINT UQ_cycle_machine_date UNIQUE (machine_name, date);
-- ALTER TABLE dbo.tb_efficiency_actual ADD CONSTRAINT UQ_eff_machine_date UNIQUE (machine_name, date);
