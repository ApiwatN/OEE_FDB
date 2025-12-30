BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[tbm_operator] (
    [id] INT NOT NULL IDENTITY(1,1),
    [operator_name] NVARCHAR(1000) NOT NULL,
    [emp_no] NVARCHAR(1000) NOT NULL,
    [picture_path] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [tbm_operator_status_df] DEFAULT 'active',
    CONSTRAINT [tbm_operator_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [tbm_operator_emp_no_key] UNIQUE NONCLUSTERED ([emp_no])
);

-- CreateTable
CREATE TABLE [dbo].[tbm_machine] (
    [id] INT NOT NULL IDENTITY(1,1),
    [machine_area] NVARCHAR(1000) NOT NULL,
    [machine_type] NVARCHAR(1000) NOT NULL,
    [machine_name] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [tbm_machine_status_df] DEFAULT 'active',
    CONSTRAINT [tbm_machine_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [tbm_machine_machine_name_key] UNIQUE NONCLUSTERED ([machine_name])
);

-- CreateTable
CREATE TABLE [dbo].[tbm_model] (
    [id] INT NOT NULL IDENTITY(1,1),
    [model_name] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [tbm_model_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tb_output_target] (
    [id] INT NOT NULL IDENTITY(1,1),
    [date] DATE NOT NULL,
    [machine_name] NVARCHAR(1000),
    [model_name] NVARCHAR(1000),
    [pc_target] INT NOT NULL,
    [cycle_time_target] FLOAT(53) NOT NULL,
    [eff_target] FLOAT(53) NOT NULL,
    [target_07] INT CONSTRAINT [tb_output_target_target_07_df] DEFAULT 0,
    [target_08] INT CONSTRAINT [tb_output_target_target_08_df] DEFAULT 0,
    [target_09] INT CONSTRAINT [tb_output_target_target_09_df] DEFAULT 0,
    [target_10] INT CONSTRAINT [tb_output_target_target_10_df] DEFAULT 0,
    [target_11] INT CONSTRAINT [tb_output_target_target_11_df] DEFAULT 0,
    [target_12] INT CONSTRAINT [tb_output_target_target_12_df] DEFAULT 0,
    [target_13] INT CONSTRAINT [tb_output_target_target_13_df] DEFAULT 0,
    [target_14] INT CONSTRAINT [tb_output_target_target_14_df] DEFAULT 0,
    [target_15] INT CONSTRAINT [tb_output_target_target_15_df] DEFAULT 0,
    [target_16] INT CONSTRAINT [tb_output_target_target_16_df] DEFAULT 0,
    [target_17] INT CONSTRAINT [tb_output_target_target_17_df] DEFAULT 0,
    [target_18] INT CONSTRAINT [tb_output_target_target_18_df] DEFAULT 0,
    [target_19] INT CONSTRAINT [tb_output_target_target_19_df] DEFAULT 0,
    [target_20] INT CONSTRAINT [tb_output_target_target_20_df] DEFAULT 0,
    [target_21] INT CONSTRAINT [tb_output_target_target_21_df] DEFAULT 0,
    [target_22] INT CONSTRAINT [tb_output_target_target_22_df] DEFAULT 0,
    [target_23] INT CONSTRAINT [tb_output_target_target_23_df] DEFAULT 0,
    [target_00] INT CONSTRAINT [tb_output_target_target_00_df] DEFAULT 0,
    [target_01] INT CONSTRAINT [tb_output_target_target_01_df] DEFAULT 0,
    [target_02] INT CONSTRAINT [tb_output_target_target_02_df] DEFAULT 0,
    [target_03] INT CONSTRAINT [tb_output_target_target_03_df] DEFAULT 0,
    [target_04] INT CONSTRAINT [tb_output_target_target_04_df] DEFAULT 0,
    [target_05] INT CONSTRAINT [tb_output_target_target_05_df] DEFAULT 0,
    [target_06] INT CONSTRAINT [tb_output_target_target_06_df] DEFAULT 0,
    CONSTRAINT [tb_output_target_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tb_output_actual] (
    [id] INT NOT NULL IDENTITY(1,1),
    [date] DATE NOT NULL,
    [machine_name] NVARCHAR(1000) NOT NULL,
    [actual_07] INT CONSTRAINT [tb_output_actual_actual_07_df] DEFAULT 0,
    [actual_08] INT CONSTRAINT [tb_output_actual_actual_08_df] DEFAULT 0,
    [actual_09] INT CONSTRAINT [tb_output_actual_actual_09_df] DEFAULT 0,
    [actual_10] INT CONSTRAINT [tb_output_actual_actual_10_df] DEFAULT 0,
    [actual_11] INT CONSTRAINT [tb_output_actual_actual_11_df] DEFAULT 0,
    [actual_12] INT CONSTRAINT [tb_output_actual_actual_12_df] DEFAULT 0,
    [actual_13] INT CONSTRAINT [tb_output_actual_actual_13_df] DEFAULT 0,
    [actual_14] INT CONSTRAINT [tb_output_actual_actual_14_df] DEFAULT 0,
    [actual_15] INT CONSTRAINT [tb_output_actual_actual_15_df] DEFAULT 0,
    [actual_16] INT CONSTRAINT [tb_output_actual_actual_16_df] DEFAULT 0,
    [actual_17] INT CONSTRAINT [tb_output_actual_actual_17_df] DEFAULT 0,
    [actual_18] INT CONSTRAINT [tb_output_actual_actual_18_df] DEFAULT 0,
    [actual_19] INT CONSTRAINT [tb_output_actual_actual_19_df] DEFAULT 0,
    [actual_20] INT CONSTRAINT [tb_output_actual_actual_20_df] DEFAULT 0,
    [actual_21] INT CONSTRAINT [tb_output_actual_actual_21_df] DEFAULT 0,
    [actual_22] INT CONSTRAINT [tb_output_actual_actual_22_df] DEFAULT 0,
    [actual_23] INT CONSTRAINT [tb_output_actual_actual_23_df] DEFAULT 0,
    [actual_00] INT CONSTRAINT [tb_output_actual_actual_00_df] DEFAULT 0,
    [actual_01] INT CONSTRAINT [tb_output_actual_actual_01_df] DEFAULT 0,
    [actual_02] INT CONSTRAINT [tb_output_actual_actual_02_df] DEFAULT 0,
    [actual_03] INT CONSTRAINT [tb_output_actual_actual_03_df] DEFAULT 0,
    [actual_04] INT CONSTRAINT [tb_output_actual_actual_04_df] DEFAULT 0,
    [actual_05] INT CONSTRAINT [tb_output_actual_actual_05_df] DEFAULT 0,
    [actual_06] INT CONSTRAINT [tb_output_actual_actual_06_df] DEFAULT 0,
    CONSTRAINT [tb_output_actual_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tb_cycle_time_actual] (
    [id] INT NOT NULL IDENTITY(1,1),
    [date] DATE NOT NULL,
    [machine_name] NVARCHAR(1000) NOT NULL,
    [cycle_07] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_07_df] DEFAULT 0,
    [cycle_08] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_08_df] DEFAULT 0,
    [cycle_09] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_09_df] DEFAULT 0,
    [cycle_10] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_10_df] DEFAULT 0,
    [cycle_11] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_11_df] DEFAULT 0,
    [cycle_12] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_12_df] DEFAULT 0,
    [cycle_13] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_13_df] DEFAULT 0,
    [cycle_14] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_14_df] DEFAULT 0,
    [cycle_15] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_15_df] DEFAULT 0,
    [cycle_16] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_16_df] DEFAULT 0,
    [cycle_17] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_17_df] DEFAULT 0,
    [cycle_18] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_18_df] DEFAULT 0,
    [cycle_19] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_19_df] DEFAULT 0,
    [cycle_20] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_20_df] DEFAULT 0,
    [cycle_21] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_21_df] DEFAULT 0,
    [cycle_22] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_22_df] DEFAULT 0,
    [cycle_23] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_23_df] DEFAULT 0,
    [cycle_00] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_00_df] DEFAULT 0,
    [cycle_01] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_01_df] DEFAULT 0,
    [cycle_02] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_02_df] DEFAULT 0,
    [cycle_03] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_03_df] DEFAULT 0,
    [cycle_04] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_04_df] DEFAULT 0,
    [cycle_05] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_05_df] DEFAULT 0,
    [cycle_06] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_06_df] DEFAULT 0,
    CONSTRAINT [tb_cycle_time_actual_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tb_efficiency_actual] (
    [id] INT NOT NULL IDENTITY(1,1),
    [date] DATE NOT NULL,
    [machine_name] NVARCHAR(1000) NOT NULL,
    [eff_07] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_07_df] DEFAULT 0,
    [eff_08] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_08_df] DEFAULT 0,
    [eff_09] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_09_df] DEFAULT 0,
    [eff_10] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_10_df] DEFAULT 0,
    [eff_11] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_11_df] DEFAULT 0,
    [eff_12] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_12_df] DEFAULT 0,
    [eff_13] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_13_df] DEFAULT 0,
    [eff_14] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_14_df] DEFAULT 0,
    [eff_15] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_15_df] DEFAULT 0,
    [eff_16] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_16_df] DEFAULT 0,
    [eff_17] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_17_df] DEFAULT 0,
    [eff_18] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_18_df] DEFAULT 0,
    [eff_19] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_19_df] DEFAULT 0,
    [eff_20] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_20_df] DEFAULT 0,
    [eff_21] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_21_df] DEFAULT 0,
    [eff_22] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_22_df] DEFAULT 0,
    [eff_23] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_23_df] DEFAULT 0,
    [eff_00] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_00_df] DEFAULT 0,
    [eff_01] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_01_df] DEFAULT 0,
    [eff_02] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_02_df] DEFAULT 0,
    [eff_03] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_03_df] DEFAULT 0,
    [eff_04] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_04_df] DEFAULT 0,
    [eff_05] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_05_df] DEFAULT 0,
    [eff_06] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_06_df] DEFAULT 0,
    CONSTRAINT [tb_efficiency_actual_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tb_oee] (
    [id] INT NOT NULL IDENTITY(1,1),
    [date] DATE NOT NULL,
    [machine_name] NVARCHAR(1000) NOT NULL,
    [oee_value] FLOAT(53) CONSTRAINT [tb_oee_oee_value_df] DEFAULT 0,
    CONSTRAINT [tb_oee_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tb_history_working] (
    [id] INT NOT NULL IDENTITY(1,1),
    [date] DATE NOT NULL,
    [machine_name] NVARCHAR(1000) NOT NULL,
    [emp_no] NVARCHAR(1000),
    [shift] NVARCHAR(1000) NOT NULL,
    [start_time] DATETIME2 NOT NULL,
    [end_time] DATETIME2,
    CONSTRAINT [tb_history_working_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[tb_history_working] ADD CONSTRAINT [tb_history_working_emp_no_fkey] FOREIGN KEY ([emp_no]) REFERENCES [dbo].[tbm_operator]([emp_no]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
