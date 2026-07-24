*** Settings ***
Documentation
...    Ventas USDM 2.0 — Sidebar Navigation Helper
...
...    LOCATOR STRATEGY
...    ─────────────────
...    Top-level accordion : css=a[data-toggle="collapse"]:text-is("<MenuName>")
...        :text-is()  = exact text match  (prevents "POS Sales" matching "Sales")
...        :has-text() = substring match   (DO NOT USE for menu triggers)
...
...    Submenu links       : css=a[href*="<hrefFragment>"]
...        href is unique per page — immune to label duplicates and DOM restructuring.
...        Confirmed from live DOM inspection 2026-07-19.
...
...    MENUS SHARING #children-for-quicklink
...    Stock Management, Inventory Configurations, Orders, Sales, POS Sales,
...    Airtel Shop Management all share the same collapse container.
...    Always expand the correct parent with :text-is() before clicking the child link.

Library    Browser

*** Variables ***
${NAV_TIMEOUT}    30s

*** Keywords ***

# ══════════════════════════════════════════════════════════════════════════════
# HIERARCHY
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Geo Hierarchy
    Click    css=a[data-toggle="collapse"]:text-is("Hierarchy")
    Wait For Elements State    css=a[href*="geoTerritory"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="geoTerritory"]

Navigate To Customer Hierarchy
    Click    css=a[data-toggle="collapse"]:text-is("Hierarchy")
    Wait For Elements State    css=a[href*="organizationHierarchy"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="organizationHierarchy"]

# ══════════════════════════════════════════════════════════════════════════════
# USERS
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Internal Users
    Click    css=a[data-toggle="collapse"]:text-is("Users")
    Wait For Elements State    css=a[href*="internalEmploee"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="internalEmploee"]

Navigate To External Users
    Click    css=a[data-toggle="collapse"]:text-is("Users")
    Wait For Elements State    css=a[href*="externalEmployees"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="externalEmployees"]

Navigate To Installer Users
    Click    css=a[data-toggle="collapse"]:text-is("Users")
    Wait For Elements State    css=a[href*="/cpm/Installer"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="/cpm/Installer"]

# ══════════════════════════════════════════════════════════════════════════════
# CHANNEL PARTNERS
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Customer Management
    Click    css=a[data-toggle="collapse"]:text-is("Channel Partners")
    Wait For Elements State    css=a[href*="partnerMfe"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="partnerMfe"]

Navigate To Operator Warehouse
    Click    css=a[data-toggle="collapse"]:text-is("Channel Partners")
    Wait For Elements State    css=a[href*="/warehouse"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="/warehouse"]

# ══════════════════════════════════════════════════════════════════════════════
# PAYMENT MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Credit And Debit Note
    Click    css=a[data-toggle="collapse"]:text-is("Payment Management")
    Wait For Elements State    css=a[href*="creditAndDebitNote"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="creditAndDebitNote"]

Navigate To Payment Receipt
    Click    css=a[data-toggle="collapse"]:text-is("Payment Management")
    Wait For Elements State    css=a[href*="paymentReceipt"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="paymentReceipt"]

# ══════════════════════════════════════════════════════════════════════════════
# DEACTIVATE VOUCHER
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Deactivate Voucher
    Click    css=a[data-toggle="collapse"]:text-is("Deactivate Voucher")
    Wait For Elements State    css=a[href*="pos/deactivate"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="pos/deactivate"]

# ══════════════════════════════════════════════════════════════════════════════
# REPORTS
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Order Item Summary Report
    Click    css=a[data-toggle="collapse"]:text-is("Reports")
    Wait For Elements State    css=a[href*="orderItemSummaryReport"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="orderItemSummaryReport"]

Navigate To Cashier Collection Summary Report
    Click    css=a[data-toggle="collapse"]:text-is("Reports")
    Wait For Elements State    css=a[href*="cashierCollectionSummaryReport"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="cashierCollectionSummaryReport"]

Navigate To Invoice Details Report
    Click    css=a[data-toggle="collapse"]:text-is("Reports")
    Wait For Elements State    css=a[href*="invoiceDetailsReport"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="invoiceDetailsReport"]

Navigate To POS Invoice Details Report
    Click    css=a[data-toggle="collapse"]:text-is("Reports")
    Wait For Elements State    css=a[href*="posInvoiceDetailsReport"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="posInvoiceDetailsReport"]

# ══════════════════════════════════════════════════════════════════════════════
# STOCK CREATION
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Generate Voucher
    Click    css=a[data-toggle="collapse"]:text-is("Stock Creation")
    Wait For Elements State    css=a[href*="generateVoucher"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="generateVoucher"]

# ══════════════════════════════════════════════════════════════════════════════
# ACTIVATE VOUCHER
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Activate Voucher
    Click    css=a[data-toggle="collapse"]:text-is("Activate Voucher")
    Wait For Elements State    css=a[href*="pos/activate"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="pos/activate"]

# ══════════════════════════════════════════════════════════════════════════════
# MASTER CONFIGURATIONS
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Dropdown Configurations
    Click    css=a[data-toggle="collapse"]:text-is("Master Configurations")
    Wait For Elements State    css=a[href*="dropdownConfigurations"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="dropdownConfigurations"]

Navigate To Currency Configuration
    Click    css=a[data-toggle="collapse"]:text-is("Master Configurations")
    Wait For Elements State    css=a[href*="currencyConfig"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="currencyConfig"]

Navigate To Conversion Rates
    Click    css=a[data-toggle="collapse"]:text-is("Master Configurations")
    Wait For Elements State    css=a[href*="/pos/conversion"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="/pos/conversion"]

Navigate To Message Template
    Click    css=a[data-toggle="collapse"]:text-is("Master Configurations")
    Wait For Elements State    css=a[href*="messageTemplate"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="messageTemplate"]

Navigate To Order Number Configuration
    Click    css=a[data-toggle="collapse"]:text-is("Master Configurations")
    Wait For Elements State    css=a[href*="orderConfig"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="orderConfig"]

# ══════════════════════════════════════════════════════════════════════════════
# APPROVALS
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Approval Workflow
    Click    css=a[data-toggle="collapse"]:text-is("Approvals")
    Wait For Elements State    css=a[href*="approvalWorkflow"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="approvalWorkflow"]

Navigate To My Requests
    Click    css=a[data-toggle="collapse"]:text-is("Approvals")
    Wait For Elements State    css=a[href*="approvalmyrequest"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="approvalmyrequest"]

Navigate To My Tasks
    Click    css=a[data-toggle="collapse"]:text-is("Approvals")
    Wait For Elements State    css=a[href*="approvalmytask"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="approvalmytask"]

Navigate To All Pending Tasks
    Click    css=a[data-toggle="collapse"]:text-is("Approvals")
    Wait For Elements State    css=a[href*="cpmAllPendingTasks"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="cpmAllPendingTasks"]

# ══════════════════════════════════════════════════════════════════════════════
# STOCK MANAGEMENT  (shares #children-for-quicklink)
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Stock File Upload List
    Click    css=a[data-toggle="collapse"]:text-is("Stock Management")
    Wait For Elements State    css=a[href*="FileUploadList"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="FileUploadList"]

Navigate To Stock
    Click    css=a[data-toggle="collapse"]:text-is("Stock Management")
    Wait For Elements State    css=a[href*="arm-stock"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="arm-stock"]

Navigate To Transfer Request
    Click    css=a[data-toggle="collapse"]:text-is("Stock Management")
    Wait For Elements State    css=a[href*="arm/StockManagement"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="arm/StockManagement"]

Navigate To Transfer Order
    Click    css=a[data-toggle="collapse"]:text-is("Stock Management")
    Wait For Elements State    css=a[href*="transferOrder"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="transferOrder"]

Navigate To Goods Receive
    Click    css=a[data-toggle="collapse"]:text-is("Stock Management")
    Wait For Elements State    css=a[href*="StockGR"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="StockGR"]

Navigate To Stock View
    Click    css=a[data-toggle="collapse"]:text-is("Stock Management")
    Wait For Elements State    css=a[href*="stock-view"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="stock-view"]

Navigate To State Status Update
    Click    css=a[data-toggle="collapse"]:text-is("Stock Management")
    Wait For Elements State    css=a[href*="state-status-update"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="state-status-update"]

Navigate To Stock Repair Return
    Click    css=a[data-toggle="collapse"]:text-is("Stock Management")
    Wait For Elements State    css=a[href*="repair-return-mfe"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="repair-return-mfe"]

# ══════════════════════════════════════════════════════════════════════════════
# INVENTORY CONFIGURATIONS  (shares #children-for-quicklink)
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Inventory
    Click    css=a[data-toggle="collapse"]:text-is("Inventory Configurations")
    Wait For Elements State    css=a[href*="AssetInventory"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="AssetInventory"]

Navigate To Operator Transfer Request
    Click    css=a[data-toggle="collapse"]:text-is("Inventory Configurations")
    Wait For Elements State    css=a[href*="operator-trasfer-request-mfe"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="operator-trasfer-request-mfe"]

Navigate To Operator Transfer Order
    Click    css=a[data-toggle="collapse"]:text-is("Inventory Configurations")
    Wait For Elements State    css=a[href*="operator-trasfer-order-mfe"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="operator-trasfer-order-mfe"]

Navigate To Operator Goods Receive
    Click    css=a[data-toggle="collapse"]:text-is("Inventory Configurations")
    Wait For Elements State    css=a[href*="operator-goods-receive-mfe"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="operator-goods-receive-mfe"]

Navigate To Product Update
    Click    css=a[data-toggle="collapse"]:text-is("Inventory Configurations")
    Wait For Elements State    css=a[href*="product-update"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="product-update"]

Navigate To Product Type
    Click    css=a[data-toggle="collapse"]:text-is("Inventory Configurations")
    Wait For Elements State    css=a[href*="ProductType"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="ProductType"]

Navigate To Product
    Click    css=a[data-toggle="collapse"]:text-is("Inventory Configurations")
    Wait For Elements State    css=a[href*="/arm/Product"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="/arm/Product"]

# ══════════════════════════════════════════════════════════════════════════════
# SALES  (shares #children-for-quicklink)
# Primary Sales here = ROM B2B sales flow  (href: /rom/sellIn-order)
# NOT the same as POS Sales > Primary Sales  (href: /pos/primarysales)
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Primary Sales
    Click    css=a[data-toggle="collapse"]:text-is("Sales")
    Wait For Elements State    css=a[href*="sellIn-order"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="sellIn-order"]

Navigate To Primary Sales Return
    Click    css=a[data-toggle="collapse"]:text-is("Sales")
    Wait For Elements State    css=a[href*="sell-in-return"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="sell-in-return"]

Navigate To POS Sales RA
    Click    css=a[data-toggle="collapse"]:text-is("Sales")
    Wait For Elements State    css=a[href*="pos-sales-ra"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="pos-sales-ra"]

Navigate To ESB Inventory Posting
    Click    css=a[data-toggle="collapse"]:text-is("Sales")
    Wait For Elements State    css=a[href*="esb-inventory-posting"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="esb-inventory-posting"]

# ══════════════════════════════════════════════════════════════════════════════
# POS SALES  (shares #children-for-quicklink)
# POS Primary Sales = href /pos/primarysales  (different from Sales > Primary Sales)
# ══════════════════════════════════════════════════════════════════════════════
Navigate To POS Primary Sales
    Click    css=a[data-toggle="collapse"]:text-is("POS Sales")
    Wait For Elements State    css=a[href*="pos/primarysales"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="pos/primarysales"]

Navigate To POS Sales
    Click    css=a[data-toggle="collapse"]:text-is("POS Sales")
    Wait For Elements State    css=a[href*="possales"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="possales"]

Navigate To POS Sales EVD
    Click    css=a[data-toggle="collapse"]:text-is("POS Sales")
    Wait For Elements State    css=a[href*="possalesEVD"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="possalesEVD"]

Navigate To EVD Stock Transfer
    Click    css=a[data-toggle="collapse"]:text-is("POS Sales")
    Wait For Elements State    css=a[href*="EVDStockTransfer"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="EVDStockTransfer"]

Navigate To Installer Supply Order
    Click    css=a[data-toggle="collapse"]:text-is("POS Sales")
    Wait For Elements State    css=a[href*="installerorders"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="installerorders"]

Navigate To HBB Consumption Order
    Click    css=a[data-toggle="collapse"]:text-is("POS Sales")
    Wait For Elements State    css=a[href*="hbbConsumptionOrder"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="hbbConsumptionOrder"]

# ══════════════════════════════════════════════════════════════════════════════
# AIRTEL SHOP MANAGEMENT  (shares #children-for-quicklink)
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Cashier Allocation
    Click    css=a[data-toggle="collapse"]:text-is("Airtel Shop Management")
    Wait For Elements State    css=a[href*="operator-transfer-req"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="operator-transfer-req"]

Navigate To Safe Management
    Click    css=a[data-toggle="collapse"]:text-is("Airtel Shop Management")
    Wait For Elements State    css=a[href*="safe-management"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="safe-management"]

Navigate To Cash Register
    Click    css=a[data-toggle="collapse"]:text-is("Airtel Shop Management")
    Wait For Elements State    css=a[href*="cash-register"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="cash-register"]

# ══════════════════════════════════════════════════════════════════════════════
# PARTNER REPORTS  (parameterised — pass the href fragment)
# Example: Navigate To Partner Report    FinanceUserListReport
# ══════════════════════════════════════════════════════════════════════════════
Navigate To Partner Report
    [Arguments]    ${href_fragment}
    Click    css=a[data-toggle="collapse"]:text-is("Partner Reports")
    Wait For Elements State    css=a[href*="${href_fragment}"]    visible    ${NAV_TIMEOUT}
    Click    css=a[href*="${href_fragment}"]
