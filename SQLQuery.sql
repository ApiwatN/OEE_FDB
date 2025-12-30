INSERT INTO tbm_operator (operator_name, operator_code, picture_path, status)
VALUES
('Somchai Jaidee', 'LE114', 'E:\\OEE_v2\\operator_picture\\LE114.png', 'active'),
('Somsri Saiseu', 'LE115', 'E:\\OEE_v2\\operator_picture\\LE115.png', 'active'),
('Jittra Phithiphan', 'LE116', 'E:\\OEE_v2\\operator_picture\\LE116.png', 'active'),
('Anan Tangjaidee', 'LE117', 'E:\\OEE_v2\\operator_picture\\LE117.png', 'active');

INSERT INTO tbm_model (model_name, status)
VALUES
('Model A', 'active'),
('Model B', 'active'),
('Model C', 'active'),
('Model D', 'active'),
('Model E', 'active'),
('Model F', 'active');


DECLARE 
    @area NVARCHAR(50),
    @type NVARCHAR(50),
    @machineNo INT;

------------------------------------------------------------
-- 🔹 ECM AREA
------------------------------------------------------------
DECLARE @ecmTypes TABLE (type NVARCHAR(50));
INSERT INTO @ecmTypes VALUES (N'CNC'), (N'DCP'), (N'AHV'), (N'GRN'), (N'LTH'), (N'MCH');
SET @area = N'ECM';

DECLARE ecm_cursor CURSOR FOR SELECT type FROM @ecmTypes;
OPEN ecm_cursor;
FETCH NEXT FROM ecm_cursor INTO @type;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @machineNo = 1;
    WHILE @machineNo <= (5 + ABS(CHECKSUM(NEWID())) % 6)
    BEGIN
        INSERT INTO tbm_machine (machine_area, machine_type, machine_name, status)
        VALUES (@area, @type, CONCAT(@type, RIGHT(CONCAT('00', @machineNo), 3)), 'active');
        SET @machineNo += 1;
    END
    FETCH NEXT FROM ecm_cursor INTO @type;
END
CLOSE ecm_cursor;
DEALLOCATE ecm_cursor;

------------------------------------------------------------
-- 🔹 CLASS100 AREA
------------------------------------------------------------
DECLARE @classTypes TABLE (type NVARCHAR(50));
INSERT INTO @classTypes VALUES (N'AHV'), (N'BLW'), (N'CUT'), (N'GRD'), (N'PNT');
SET @area = N'CLASS100';

DECLARE class_cursor CURSOR FOR SELECT type FROM @classTypes;
OPEN class_cursor;
FETCH NEXT FROM class_cursor INTO @type;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @machineNo = 1;
    WHILE @machineNo <= (5 + ABS(CHECKSUM(NEWID())) % 6)
    BEGIN
        INSERT INTO tbm_machine (machine_area, machine_type, machine_name, status)
        VALUES (@area, @type, CONCAT(@type, RIGHT(CONCAT('00', @machineNo), 3)), 'active');
        SET @machineNo += 1;
    END
    FETCH NEXT FROM class_cursor INTO @type;
END
CLOSE class_cursor;
DEALLOCATE class_cursor;

------------------------------------------------------------
-- 🔹 PRESS AREA
------------------------------------------------------------
DECLARE @pressTypes TABLE (type NVARCHAR(50));
INSERT INTO @pressTypes VALUES (N'PRS'), (N'HTR'), (N'STP'), (N'CMP'), (N'DCP'), (N'PCK'), (N'CUT');
SET @area = N'PRESS';

DECLARE press_cursor CURSOR FOR SELECT type FROM @pressTypes;
OPEN press_cursor;
FETCH NEXT FROM press_cursor INTO @type;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @machineNo = 1;
    WHILE @machineNo <= (5 + ABS(CHECKSUM(NEWID())) % 6)
    BEGIN
        INSERT INTO tbm_machine (machine_area, machine_type, machine_name, status)
        VALUES (@area, @type, CONCAT(@type, RIGHT(CONCAT('00', @machineNo), 3)), 'active');
        SET @machineNo += 1;
    END
    FETCH NEXT FROM press_cursor INTO @type;
END
CLOSE press_cursor;
DEALLOCATE press_cursor;

