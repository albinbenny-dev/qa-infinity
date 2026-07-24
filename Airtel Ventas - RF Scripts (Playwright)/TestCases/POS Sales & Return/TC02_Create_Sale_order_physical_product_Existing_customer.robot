*** Settings ***
Library       Browser
Library       DateTime
Resource      resources/Common.robot
Resource      resources/LoginPage.robot
Resource      resources/POSSalesPage.robot

Test Setup       Open Test Session
Test Teardown    Close Test Session


*** Test Cases ***
TC_02 Create a Sale order of physical product with Existing customer
    [Documentation]    Creates a POS sale for a new customer first (to generate the customer record),
    ...    then creates a second sale using that same customer via the existing-customer search.
    [Tags]    POS_Sales    Physical_Product    Existing_Customer    Regression

    # --- Part 1: create new customer + sale ---
    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to cash register Menu
    Store Asset from Stock View Screen    TC01    TD01
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

    # --- Part 2: re-use same customer for second sale ---
    Open Test Session
    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to cash register Menu
    Store Asset from Stock View Screen    TC01    TD01
    Navigate to POS Sales
    Navigate to POS Sales Sub Menu
    Search the Existing Customer
    Validate the Name and Number of the Existing Customer
    Enter the serial number and scan    1    Yes
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
