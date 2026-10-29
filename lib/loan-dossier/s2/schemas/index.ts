// SINH TỰ ĐỘNG bởi scripts/gen-loan-doc-schemas.mjs — KHÔNG sửa tay.
// Bảng schema zod của 27 loại FULL; tra qua s2/schema-registry.ts (T-S2-01).
import type { ZodTypeAny } from 'zod';

import { IdCardDataSchema } from './id_card';
import { VneidDataSchema } from './vneid';
import { QrCodeInfoDataSchema } from './qr_code_info';
import { ResidenceConfirmationDataSchema } from './residence_confirmation';
import { MaritalStatusConfirmationDataSchema } from './marital_status_confirmation';
import { LocalCmndConfirmationDataSchema } from './local_cmnd_confirmation';
import { SamePersonCommitmentDataSchema } from './same_person_commitment';
import { MarriageCertificateDataSchema } from './marriage_certificate';
import { BirthCertificateDataSchema } from './birth_certificate';
import { LoanApplicationDataSchema } from './loan_application';
import { PurchaseListDataSchema } from './purchase_list';
import { GoodsPurchaseContractDataSchema } from './goods_purchase_contract';
import { VehicleSaleContractDataSchema } from './vehicle_sale_contract';
import { LaborContractDataSchema } from './labor_contract';
import { SalaryConfirmationDataSchema } from './salary_confirmation';
import { IncomeStatementDataSchema } from './income_statement';
import { LandUseCertificateDataSchema } from './land_use_certificate';
import { ApartmentOwnershipCertificateDataSchema } from './apartment_ownership_certificate';
import { LandUseCertToBuyDataSchema } from './land_use_cert_to_buy';
import { VehicleRegistrationDataSchema } from './vehicle_registration';
import { VehicleInspectionDataSchema } from './vehicle_inspection';
import { RealEstateValuationReportDataSchema } from './real_estate_valuation_report';
import { MovableAssetValuationReportDataSchema } from './movable_asset_valuation_report';
import { AssetQuoteDataSchema } from './asset_quote';
import { ExternalValuationCertificateDataSchema } from './external_valuation_certificate';
import { CicDataSchema } from './cic';
import { CreditContractDataSchema } from './credit_contract';
import { VatTaxReturnDataSchema } from './vat_tax_return';
import { BalanceSheetDataSchema } from './balance_sheet';
import { FinancialPerformanceReportDataSchema } from './financial_performance_report';

export const DOC_DATA_SCHEMAS: Readonly<Record<string, ZodTypeAny>> = {
  id_card: IdCardDataSchema,
  vneid: VneidDataSchema,
  qr_code_info: QrCodeInfoDataSchema,
  residence_confirmation: ResidenceConfirmationDataSchema,
  marital_status_confirmation: MaritalStatusConfirmationDataSchema,
  local_cmnd_confirmation: LocalCmndConfirmationDataSchema,
  same_person_commitment: SamePersonCommitmentDataSchema,
  marriage_certificate: MarriageCertificateDataSchema,
  birth_certificate: BirthCertificateDataSchema,
  loan_application: LoanApplicationDataSchema,
  purchase_list: PurchaseListDataSchema,
  goods_purchase_contract: GoodsPurchaseContractDataSchema,
  vehicle_sale_contract: VehicleSaleContractDataSchema,
  labor_contract: LaborContractDataSchema,
  salary_confirmation: SalaryConfirmationDataSchema,
  income_statement: IncomeStatementDataSchema,
  land_use_certificate: LandUseCertificateDataSchema,
  apartment_ownership_certificate: ApartmentOwnershipCertificateDataSchema,
  land_use_cert_to_buy: LandUseCertToBuyDataSchema,
  vehicle_registration: VehicleRegistrationDataSchema,
  vehicle_inspection: VehicleInspectionDataSchema,
  real_estate_valuation_report: RealEstateValuationReportDataSchema,
  movable_asset_valuation_report: MovableAssetValuationReportDataSchema,
  asset_quote: AssetQuoteDataSchema,
  external_valuation_certificate: ExternalValuationCertificateDataSchema,
  cic: CicDataSchema,
  credit_contract: CreditContractDataSchema,
  vat_tax_return: VatTaxReturnDataSchema,
  balance_sheet: BalanceSheetDataSchema,
  financial_performance_report: FinancialPerformanceReportDataSchema,
};

export { IdCardDataSchema } from './id_card';
export { VneidDataSchema } from './vneid';
export { QrCodeInfoDataSchema } from './qr_code_info';
export { ResidenceConfirmationDataSchema } from './residence_confirmation';
export { MaritalStatusConfirmationDataSchema } from './marital_status_confirmation';
export { LocalCmndConfirmationDataSchema } from './local_cmnd_confirmation';
export { SamePersonCommitmentDataSchema } from './same_person_commitment';
export { MarriageCertificateDataSchema } from './marriage_certificate';
export { BirthCertificateDataSchema } from './birth_certificate';
export { LoanApplicationDataSchema } from './loan_application';
export { PurchaseListDataSchema } from './purchase_list';
export { GoodsPurchaseContractDataSchema } from './goods_purchase_contract';
export { VehicleSaleContractDataSchema } from './vehicle_sale_contract';
export { LaborContractDataSchema } from './labor_contract';
export { SalaryConfirmationDataSchema } from './salary_confirmation';
export { IncomeStatementDataSchema } from './income_statement';
export { LandUseCertificateDataSchema } from './land_use_certificate';
export { ApartmentOwnershipCertificateDataSchema } from './apartment_ownership_certificate';
export { LandUseCertToBuyDataSchema } from './land_use_cert_to_buy';
export { VehicleRegistrationDataSchema } from './vehicle_registration';
export { VehicleInspectionDataSchema } from './vehicle_inspection';
export { RealEstateValuationReportDataSchema } from './real_estate_valuation_report';
export { MovableAssetValuationReportDataSchema } from './movable_asset_valuation_report';
export { AssetQuoteDataSchema } from './asset_quote';
export { ExternalValuationCertificateDataSchema } from './external_valuation_certificate';
export { CicDataSchema } from './cic';
export { CreditContractDataSchema } from './credit_contract';
export { VatTaxReturnDataSchema } from './vat_tax_return';
export { BalanceSheetDataSchema } from './balance_sheet';
export { FinancialPerformanceReportDataSchema } from './financial_performance_report';
export type { IdCardData } from './id_card';
export type { VneidData } from './vneid';
export type { QrCodeInfoData } from './qr_code_info';
export type { ResidenceConfirmationData } from './residence_confirmation';
export type { MaritalStatusConfirmationData } from './marital_status_confirmation';
export type { LocalCmndConfirmationData } from './local_cmnd_confirmation';
export type { SamePersonCommitmentData } from './same_person_commitment';
export type { MarriageCertificateData } from './marriage_certificate';
export type { BirthCertificateData } from './birth_certificate';
export type { LoanApplicationData } from './loan_application';
export type { PurchaseListData } from './purchase_list';
export type { GoodsPurchaseContractData } from './goods_purchase_contract';
export type { VehicleSaleContractData } from './vehicle_sale_contract';
export type { LaborContractData } from './labor_contract';
export type { SalaryConfirmationData } from './salary_confirmation';
export type { IncomeStatementData } from './income_statement';
export type { LandUseCertificateData } from './land_use_certificate';
export type { ApartmentOwnershipCertificateData } from './apartment_ownership_certificate';
export type { LandUseCertToBuyData } from './land_use_cert_to_buy';
export type { VehicleRegistrationData } from './vehicle_registration';
export type { VehicleInspectionData } from './vehicle_inspection';
export type { RealEstateValuationReportData } from './real_estate_valuation_report';
export type { MovableAssetValuationReportData } from './movable_asset_valuation_report';
export type { AssetQuoteData } from './asset_quote';
export type { ExternalValuationCertificateData } from './external_valuation_certificate';
export type { CicData } from './cic';
export type { CreditContractData } from './credit_contract';
export type { VatTaxReturnData } from './vat_tax_return';
export type { BalanceSheetData } from './balance_sheet';
export type { FinancialPerformanceReportData } from './financial_performance_report';
