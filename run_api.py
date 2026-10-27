"""
Script to call the VPBank DU transform API.
Reads json_input from api_payload.json file.
Usage: python run_api.py
"""
import os
import requests
import json

url = "https://du.aws.rpa.vpbank.dev/api/v1/transform"
# API key from env, never hardcoded (docs/SECURITY-RULES.md §10).
headers = {"x-api-key": os.environ["DUGATE_API_KEY"]}

with open("api_payload.json", "r", encoding="utf-8") as f:
    json_input_str = f.read()

template_content = "**Hội sở chính**   Số 89 Láng Hạ, Đống Đa, Hà Nội   ĐT: (84.4) 249288869  Fax: (84.4) 249288867   Swift: VPBKVNVX  Website: www.vpbank.com.vn     # KHỐI XXX *Hà Nội, ngày tháng năm 202x*   # BÁO CÁO CHƯƠNG TRÌNH HÀNH ĐỘNG NĂM 202x     **Kính gửi:**   **- Tổng giám đốc VPBank**   **- Phó TGĐ thường trực VPBank**     *Năm 202x Giám đốc khối XXX đăng ký xx chương trình hành động với Tổng giám  đốc và Phó Tổng giám đốc thường trực, Khối tín dụng xin báo cáo tóm tắt một số nội dung chính về các Chương trình hành động năm 202x cụ thể như sau:*   ## I. Chương trình:   **1. Mục tiêu:**   **2. Kế hoạch triển khai:**     ## II. Chương trình:   **1. Mục tiêu:**   **2. Kế hoạch triển khai:**     ...   Trân trọng báo cáo.   *Nơi nhận:* - Như kính gửi;   - Lưu KTD.     **GIÁM ĐỐC KHỐI XXX**"

files = {
    "action": (None, "template"),
    "json_input": (None, json_input_str),
    "template_content": (None, template_content),
}

print(f"Sending request... (payload: {len(json_input_str)} chars)")
resp = requests.post(url, headers=headers, files=files, timeout=300)
print(f"Status: {resp.status_code}")
ct = resp.headers.get("content-type", "")
print(f"Content-Type: {ct}")

if "json" in ct:
    print(json.dumps(resp.json(), indent=2, ensure_ascii=False)[:8000])
elif any(x in ct for x in ["octet", "vnd", "zip", "docx", "pdf"]):
    cd = resp.headers.get("content-disposition", "")
    fn = "api_output"
    if "filename=" in cd:
        fn = cd.split("filename=")[-1].strip('"').strip("'").strip()
    with open(fn, "wb") as f:
        f.write(resp.content)
    print(f"Saved: {fn} ({len(resp.content)} bytes)")
else:
    print(resp.text[:8000])
