BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[tb_efficiency_actual] ADD [eff_actual] FLOAT(53) CONSTRAINT [tb_efficiency_actual_eff_actual_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
