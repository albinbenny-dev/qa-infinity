*** Settings ***
Library       Browser
Library       DateTime
Resource      resources/Common.robot
Resource      resources/LoginPage.robot
Resource      resources/POSSalesPage.robot

Test Setup       Open Test Session
Test Teardown    Close Test Session


*** Test Cases ***
TC_01 Create a Sale order of physical product with New customer
    [Documentation]    Validate POS Sale order creation for a new walk-in customer,
    ...    paying by cash, and verify the completed order + suborder statuses.
    [Tags]    POS_Sales    Physical_Product    New_Customer    Smoke

    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to POS Sales
    Navigate to POS Sales Sub Menu
    Navigate to New Customer Details Page
    Enter the Details for New Customer and Create    TC01    TD01
    Enter the serial number and scan
    Verify the Payment Options
    Choose Payment Method And Submit    TC01    TD01
    Logout as User

    Open Test Session
    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to POS Sales
    Navigate to POS Sales Sub Menu
    Search the created Sale Order
    Verify the created Sale Order
    Verify the status of Suborders
    Navigate to cash register Menu
    Validation for Cash and Change value    TC01    TD01
