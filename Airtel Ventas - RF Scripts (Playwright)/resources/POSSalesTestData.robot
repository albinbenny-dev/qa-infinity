*** Settings ***
# ============================================================
# POS Sales & Return — Test Data
# Upload this file via QA Infinity frontend (Scripts > Upload Resource)
#
# Naming convention:  &{<SheetName>_<CaseID>_<DataID>}
# Access in keyword:  Fetch From Excel    ${Airtel_Testdata}    POSsales    TC01    TD01
# ============================================================


*** Variables ***

# ------------------------------------------------------------
# TC01 — Physical sale, new customer, cash payment
# ------------------------------------------------------------
&{POSsales_TC01_TD01}
...    InvoiceType=B2C
...    CashAmount=50000
...    BankCode=NBC
...    BankName=NBC Bank
...    TransactionID=TXN123456789
...    AirtelMoneyAmount=50000
...    Partner=TestPartnerName
...    PartnerNumber=255700123456
...    PartnerMailID=partner@test.com
...    MSISDN=255700123456
...    EVDAmount=5000

# ------------------------------------------------------------
# TC02 — Physical sale, existing customer (re-uses TC01 data)
# ------------------------------------------------------------
&{POSsales_TC02_TD01}
...    InvoiceType=B2C
...    CashAmount=50000
...    BankCode=NBC
...    BankName=NBC Bank
...    TransactionID=TXN987654321
...    AirtelMoneyAmount=50000
...    MSISDN=255700123456
...    EVDAmount=5000

# ------------------------------------------------------------
# TC03 — Physical sale, partner
# ------------------------------------------------------------
&{POSsales_TC03_TD01}
...    InvoiceType=B2C
...    CashAmount=50000
...    BankCode=NBC
...    BankName=NBC Bank
...    TransactionID=TXN111222333
...    AirtelMoneyAmount=50000
...    Partner=TestPartnerName
...    PartnerNumber=255700123456
...    PartnerMailID=partner@test.com

# ------------------------------------------------------------
# TC04 — Multiple products (two serial numbers)
# ------------------------------------------------------------
&{POSsales_TC04_TD01}
...    InvoiceType=B2C
...    CashAmount=100000
...    BankCode=NBC
...    BankName=NBC Bank

# ------------------------------------------------------------
# TC05 — Multiple payment modes (Cash + Cheque split 50/50)
# ------------------------------------------------------------
&{POSsales_TC05_TD01}
...    InvoiceType=B2C
...    BankCode=NBC
...    BankName=NBC Bank
...    TransactionID=TXN444555666

# ------------------------------------------------------------
# TC06 — Airtel Money payment
# ------------------------------------------------------------
&{POSsales_TC06_TD01}
...    InvoiceType=B2C
...    TransactionID=TXN777888999
...    AirtelMoneyAmount=50000

# ------------------------------------------------------------
# TC07 — Pay more than cart amount
# ------------------------------------------------------------
&{POSsales_TC07_TD01}
...    InvoiceType=B2C
...    CashAmount=75000
...    BankCode=NBC

# ------------------------------------------------------------
# TC08 — Park order
# ------------------------------------------------------------
&{POSsales_TC08_TD01}
...    InvoiceType=B2C
...    CashAmount=50000
...    BankCode=NBC

# ------------------------------------------------------------
# TC09 — Invoice + Payment Receipt download
# (relies on order created in TC01 — no extra data needed)
# ------------------------------------------------------------
&{POSsales_TC09_TD01}
...    InvoiceType=B2C
...    CashAmount=50000
...    BankCode=NBC

# ------------------------------------------------------------
# TC10–TC16 — Return / Replace flows
# (rely on orders from earlier TCs — minimal data)
# ------------------------------------------------------------
&{POSsales_TC10_TD01}
...    InvoiceType=B2C
...    CashAmount=50000
...    BankCode=NBC

&{POSsales_TC11_TD01}
...    InvoiceType=B2C
...    CashAmount=50000
...    BankCode=NBC

&{POSsales_TC12_TD01}
...    InvoiceType=B2C
...    CashAmount=50000
...    BankCode=NBC
...    ReturnType=Damaged

&{POSsales_TC13_TD01}
...    InvoiceType=B2C
...    CashAmount=100000
...    BankCode=NBC

&{POSsales_TC14_TD01}
...    InvoiceType=B2C

&{POSsales_TC15_TD01}
...    InvoiceType=B2C

&{POSsales_TC16_TD01}
...    InvoiceType=B2C

# ------------------------------------------------------------
# TC17 — EVD sale, new customer, cash
# ------------------------------------------------------------
&{POSsales_TC17_TD01}
...    InvoiceType=B2C
...    MSISDN=255700123456
...    EVDAmount=5000
...    CashAmount=5000
...    BankCode=NBC

# ------------------------------------------------------------
# TC18 — EVD, multiple payment modes
# ------------------------------------------------------------
&{POSsales_TC18_TD01}
...    InvoiceType=B2C
...    MSISDN=255700123456
...    EVDAmount=10000
...    BankCode=NBC
...    BankName=NBC Bank

# ------------------------------------------------------------
# TC19 — EVD, Airtel Money
# ------------------------------------------------------------
&{POSsales_TC19_TD01}
...    InvoiceType=B2C
...    MSISDN=255700123456
...    EVDAmount=5000
...    TransactionID=TXN_EVD_001
...    AirtelMoneyAmount=5000

# ------------------------------------------------------------
# TC20 — EVD Invoice + Receipt download
# ------------------------------------------------------------
&{POSsales_TC20_TD01}
...    InvoiceType=B2C
...    MSISDN=255700123456
...    EVDAmount=5000
...    CashAmount=5000
...    BankCode=NBC

# ------------------------------------------------------------
# TC21 — EVD, pay more than topup amount
# ------------------------------------------------------------
&{POSsales_TC21_TD01}
...    InvoiceType=B2C
...    MSISDN=255700123456
...    EVDAmount=5000
...    CashAmount=10000
...    BankCode=NBC

# ------------------------------------------------------------
# TC22–TC24 — Bulk EVD (file paths set via env vars in project settings)
# ------------------------------------------------------------
&{POSsales_TC22_TD01}
...    InvoiceType=B2C
...    EVDAmount=5000
...    CashAmount=5000
...    BankCode=NBC

&{POSsales_TC23_TD01}
...    InvoiceType=B2C
...    EVDAmount=5000
...    CashAmount=5000
...    BankCode=NBC

&{POSsales_TC24_TD01}
...    InvoiceType=B2C
...    EVDAmount=5000
...    CashAmount=5000
...    BankCode=NBC
