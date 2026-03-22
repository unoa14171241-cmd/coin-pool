-- CreateTable
CREATE TABLE "WalletOperatorPermission" (
    "id" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "operatorWallet" TEXT NOT NULL,
    "canEvaluate" BOOLEAN NOT NULL DEFAULT true,
    "canExecute" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletOperatorPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletOperatorPermission_ownerWallet_operatorWallet_key" ON "WalletOperatorPermission"("ownerWallet", "operatorWallet");

-- CreateIndex
CREATE INDEX "WalletOperatorPermission_ownerWallet_active_idx" ON "WalletOperatorPermission"("ownerWallet", "active");

-- CreateIndex
CREATE INDEX "WalletOperatorPermission_operatorWallet_active_idx" ON "WalletOperatorPermission"("operatorWallet", "active");
