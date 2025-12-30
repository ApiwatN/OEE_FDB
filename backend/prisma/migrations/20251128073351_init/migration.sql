BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[tb_cycle_time_actual] ADD [cycle_time] FLOAT(53) CONSTRAINT [tb_cycle_time_actual_cycle_time_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[tb_output_target] ADD [accum_target] INT CONSTRAINT [tb_output_target_accum_target_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
