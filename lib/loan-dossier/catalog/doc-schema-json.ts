// JSON Schema của 27 loại FULL + `_common`, `_enums` (bản sao catalog) — để đưa vào prompt bóc tách.
// Import tĩnh để bundler (Next, esbuild worker) đóng gói được. Có test bảo đảm đủ loại FULL.
import u_common from './data/doc_schemas/_common.schema.json';
import u_enums from './data/doc_schemas/_enums.schema.json';
import apartment_ownership_certificate from './data/doc_schemas/apartment_ownership_certificate.schema.json';
import asset_quote from './data/doc_schemas/asset_quote.schema.json';
import birth_certificate from './data/doc_schemas/birth_certificate.schema.json';
import cic from './data/doc_schemas/cic.schema.json';
import credit_contract from './data/doc_schemas/credit_contract.schema.json';
import external_valuation_certificate from './data/doc_schemas/external_valuation_certificate.schema.json';
import goods_purchase_contract from './data/doc_schemas/goods_purchase_contract.schema.json';
import id_card from './data/doc_schemas/id_card.schema.json';
import income_statement from './data/doc_schemas/income_statement.schema.json';
import labor_contract from './data/doc_schemas/labor_contract.schema.json';
import land_use_cert_to_buy from './data/doc_schemas/land_use_cert_to_buy.schema.json';
import land_use_certificate from './data/doc_schemas/land_use_certificate.schema.json';
import loan_application from './data/doc_schemas/loan_application.schema.json';
import local_cmnd_confirmation from './data/doc_schemas/local_cmnd_confirmation.schema.json';
import marital_status_confirmation from './data/doc_schemas/marital_status_confirmation.schema.json';
import marriage_certificate from './data/doc_schemas/marriage_certificate.schema.json';
import movable_asset_valuation_report from './data/doc_schemas/movable_asset_valuation_report.schema.json';
import purchase_list from './data/doc_schemas/purchase_list.schema.json';
import qr_code_info from './data/doc_schemas/qr_code_info.schema.json';
import real_estate_valuation_report from './data/doc_schemas/real_estate_valuation_report.schema.json';
import residence_confirmation from './data/doc_schemas/residence_confirmation.schema.json';
import salary_confirmation from './data/doc_schemas/salary_confirmation.schema.json';
import same_person_commitment from './data/doc_schemas/same_person_commitment.schema.json';
import vehicle_inspection from './data/doc_schemas/vehicle_inspection.schema.json';
import vehicle_registration from './data/doc_schemas/vehicle_registration.schema.json';
import vehicle_sale_contract from './data/doc_schemas/vehicle_sale_contract.schema.json';
import vneid from './data/doc_schemas/vneid.schema.json';

export const COMMON_JSON_SCHEMA: unknown = u_common;
export const ENUMS_JSON_SCHEMA: unknown = u_enums;

export const DOC_JSON_SCHEMAS: Readonly<Record<string, unknown>> = {
  apartment_ownership_certificate,
  asset_quote,
  birth_certificate,
  cic,
  credit_contract,
  external_valuation_certificate,
  goods_purchase_contract,
  id_card,
  income_statement,
  labor_contract,
  land_use_cert_to_buy,
  land_use_certificate,
  loan_application,
  local_cmnd_confirmation,
  marital_status_confirmation,
  marriage_certificate,
  movable_asset_valuation_report,
  purchase_list,
  qr_code_info,
  real_estate_valuation_report,
  residence_confirmation,
  salary_confirmation,
  same_person_commitment,
  vehicle_inspection,
  vehicle_registration,
  vehicle_sale_contract,
  vneid,
};
