*** Settings ***
Resource      ${CURDIR}/Airtel_PageObjects.robot
Resource      ${CURDIR}/Airtel_TestData.robot
Resource      ${CURDIR}/POSSalesTestData.robot
Library       Browser
Library       OperatingSystem
Library       Collections
Library       String
Resource      ../resources/Read_TestData.robot
Resource      ../resources/Common.robot


*** Variables ***
${Airtel_Testdata}                        ${EMPTY}
${FilePath_POS_Bulk}                      ${EMPTY}
${FilePath_POS_Bulk_Duplicate_MSISDN}     ${EMPTY}
${FilePath_POS_Bulk_Empty_File}           ${EMPTY}
${timeout}                                60s
${interval}                               1s


*** Keywords ***

# ---------------------------------------------------------------------------
# Navigation
# ---------------------------------------------------------------------------

Navigate to POS Sales
    Verify element is visible and displayed    ${POSSalesPage}[POSSalesMenu]
    Click    ${POSSalesPage}[POSSalesMenu]
    Sleep    2s

Navigate to POS Sales Sub Menu
    Verify element is visible and displayed    ${POSSalesDetails}[POSSales]
    Click    ${POSSalesDetails}[POSSales]
    Sleep    3s
    Take Screenshot

Navigate to POS Sales EVD
    Verify element is visible and displayed    ${POSSalesDetails}[POSSalesEVD]
    Click    ${POSSalesDetails}[POSSalesEVD]
    Sleep    3s
    Take Screenshot

Select Bulk ERCV
    Verify element is visible and displayed    ${POSSalesDetails}[BulkERCV]
    Click    ${POSSalesDetails}[BulkERCV]
    Sleep    3s
    Take Screenshot

Navigate to cash register Menu
    Verify element is visible and displayed    ${POSSalesPage}[CashRegisterMenu]
    Click    ${POSSalesPage}[CashRegisterMenu]
    Sleep    2s
    Take Screenshot


# ---------------------------------------------------------------------------
# Customer search / selection
# ---------------------------------------------------------------------------

Search the Existing Customer
    [Documentation]    Searches for an existing customer in POS Sale or POS EVD flow.
    [Arguments]    ${ValuesFromTextFile}=NA    ${Search}=POS Sale
    Verify element is visible and displayed    ${POSSalesDetails}[CreateOrder]
    Click    ${POSSalesDetails}[CreateOrder]
    Sleep    3s
    Take Screenshot
    Click    ${POSSalesDetails}[EnterName]
    Sleep    3s

    IF    '${ValuesFromTextFile}' == 'Yes'
        ${FirstName_generated}=      Get File    ${CURDIR}../../../TextFiles/CustomerName.txt
        Set Global Variable    ${FirstName_generated}
        ${CustomerName_generated}=   Set Variable    ${FirstName_generated}
        Set Global Variable    ${CustomerName_generated}
        ${ContactNumber_generated}=  Get File    ${CURDIR}../../../TextFiles/ContactNumber.txt
        Set Global Variable    ${ContactNumber_generated}
        ${EmailId_generated}=        Get File    ${CURDIR}../../../TextFiles/EmailID.txt
        Set Global Variable    ${EmailId_generated}
    END
    IF    '${ValuesFromTextFile}' == 'POS EVD'
        ${FirstName_generated}=      Get File    ${CURDIR}../../../TextFiles/CustomerNameEVD.txt
        Set Global Variable    ${FirstName_generated}
        ${CustomerName_generated}=   Set Variable    ${FirstName_generated}
        Set Global Variable    ${CustomerName_generated}
        ${ContactNumber_generated}=  Get File    ${CURDIR}../../../TextFiles/ContactNumberEVD.txt
        Set Global Variable    ${ContactNumber_generated}
        ${EmailId_generated}=        Get File    ${CURDIR}../../../TextFiles/EmailIDEVD.txt
        Set Global Variable    ${EmailId_generated}
    END

    IF    '${Search}' == 'POS Sale'
        Fill Text    ${POSSalesDetails}[OverlaySearchBox]    ${FirstName_generated}
        Sleep    1s
        Take Screenshot
        Click
        ...    xpath=//strong[normalize-space()='${FirstName_generated}']/ancestor::div[contains(@class,'posales-search-result-item')][./descendant::span[normalize-space()='${ContactNumber_generated}']]//span[normalize-space()='Select']
    END
    IF    '${Search}' == 'POS EVD'
        Fill Text    ${POSSalesDetails}[OverlaySearchBoxEVD]    ${FirstName_generated}
        Sleep    1s
        Take Screenshot
        Click
        ...    xpath=//strong[normalize-space()='${FirstName_generated}']/ancestor::div[contains(@class,'pos-evd-search-result-item')][.//span[normalize-space()='${ContactNumber_generated}']]//span[normalize-space()='Select']
    END
    Sleep    1s
    Take Screenshot

Search the Partner
    [Arguments]    ${caseID}    ${dataID}
    ${data}=               Fetch From Excel    ${Airtel_Testdata}    POSsales    ${caseID}    ${dataID}
    ${PartnerName}=        getData    ${data}    Partner
    ${PartnerNumber}=      getData    ${data}    PartnerNumber
    ${PartnerMailID}=      getData    ${data}    PartnerMailID

    Set Global Variable    ${PartnerName}
    ${FirstName_generated}=    Set Variable    ${PartnerName}
    Set Global Variable    ${FirstName_generated}
    ${CustomerName_generated}=    Set Variable    ${PartnerName}
    Set Global Variable    ${CustomerName_generated}
    ${ContactNumber_generated}=    Set Variable    ${PartnerNumber}
    Set Global Variable    ${ContactNumber_generated}
    ${EmailId_generated}=    Set Variable    ${PartnerMailID}
    Set Global Variable    ${EmailId_generated}

    Verify element is visible and displayed    ${POSSalesDetails}[CreateOrder]
    Click    ${POSSalesDetails}[CreateOrder]
    Sleep    3s
    Take Screenshot
    Click    ${POSSalesDetails}[Partner]
    Sleep    1s
    Take Screenshot
    Click    ${POSSalesDetails}[EnterName]
    Sleep    3s
    Fill Text    ${POSSalesDetails}[OverlaySearchBox]    ${PartnerName}
    Sleep    1s
    Take Screenshot
    Click
    ...    xpath=//strong[normalize-space()='${PartnerName}']/ancestor::div[contains(@class,'posales-search-result-item')][./descendant::span[normalize-space()='${PartnerNumber}']]//span[normalize-space()='Select']
    Sleep    1s
    Take Screenshot

Navigate to New Customer Details Page
    [Arguments]    ${Search}=POSSales
    Verify element is visible and displayed    ${POSSalesDetails}[CreateOrder]
    Click    ${POSSalesDetails}[CreateOrder]
    Sleep    3s
    Take Screenshot
    Click    ${POSSalesDetails}[EnterName]
    Sleep    3s
    IF    '${Search}' == 'POSSales'
        Fill Text    ${POSSalesDetails}[OverlaySearchBox]    @
    END
    IF    '${Search}' == 'POSSalesEVD'
        Fill Text    ${POSSalesDetails}[OverlaySearchBoxEVD]    @
    END
    Sleep    1s
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[AddNewCustomer]
    Click    ${POSSalesDetails}[AddNewCustomer]
    Sleep    1s
    Take Screenshot


# ---------------------------------------------------------------------------
# New customer form
# ---------------------------------------------------------------------------

Enter the Details for New Customer and Create
    [Documentation]    Fills the new customer form with generated test data and submits.
    [Arguments]    ${caseID}    ${dataID}    ${StoreName}=POS Sale    ${XpathFor}=POS Sale
    ${data}=           Fetch From Excel    ${Airtel_Testdata}    POSsales    ${caseID}    ${dataID}
    ${InvoiceType}=    getData    ${data}    InvoiceType

    # Generate first name
    ${random_string}=        Generate Random String    4    [LOWER]
    ${FirstName_generated}=  Catenate    SEPARATOR=    AUTO    ${random_string}
    Set Global Variable    ${FirstName_generated}
    ${CustomerName_generated}=    Set Variable    ${FirstName_generated}
    Set Global Variable    ${CustomerName_generated}

    IF    '${StoreName}' == 'POS Sale'
        Create File    ${CURDIR}../../../TextFiles/CustomerName.txt    ${CustomerName_generated}
    END
    IF    '${StoreName}' == 'POS EVD'
        Create File    ${CURDIR}../../../TextFiles/CustomerNameEVD.txt    ${CustomerName_generated}
    END

    # Generate contact number
    ${RandomNumber}=            Generate Random String    6    012345689
    ${ContactNumber_generated}= Catenate    SEPARATOR=    500    ${RandomNumber}
    Set Global Variable    ${ContactNumber_generated}
    IF    '${StoreName}' == 'POS Sale'
        Create File    ${CURDIR}../../../TextFiles/ContactNumber.txt    ${ContactNumber_generated}
    END
    IF    '${StoreName}' == 'POS EVD'
        Create File    ${CURDIR}../../../TextFiles/ContactNumberEVD.txt    ${ContactNumber_generated}
    END

    # Generate email
    ${RandomString}=        Generate Random String    5    012345689
    ${EmailId_generated}=   Catenate    SEPARATOR=    AutoUser${RandomString}@gmail.com
    Set Global Variable    ${EmailId_generated}
    IF    '${StoreName}' == 'POS Sale'
        Create File    ${CURDIR}../../../TextFiles/EmailID.txt    ${EmailId_generated}
    END
    IF    '${StoreName}' == 'POS EVD'
        Create File    ${CURDIR}../../../TextFiles/EmailIDEVD.txt    ${EmailId_generated}
    END

    # Fill form
    Verify element is visible and displayed    ${POSSalesDetails}[FirstName]
    Fill Text    ${POSSalesDetails}[FirstName]    ${FirstName_generated}
    Verify element is visible and displayed    ${POSSalesDetails}[LastName]
    Fill Text    ${POSSalesDetails}[ContactNumber]    ${ContactNumber_generated}
    Fill Text    ${POSSalesDetails}[Email]    ${EmailId_generated}

    # Invoice type dropdown
    IF    '${XpathFor}' == 'POS Sale'
        Verify element is visible and displayed    ${POSSalesDetails}[InvoiceType]
        Click    ${POSSalesDetails}[InvoiceType]
    END
    IF    '${XpathFor}' == 'EVD'
        Verify element is visible and displayed    ${POSSalesDetails}[EVDInvoiceType]
        Click    ${POSSalesDetails}[EVDInvoiceType]
    END
    Sleep    1s
    Take Screenshot
    Verify element is visible and displayed    xpath=//div[text()='${InvoiceType}']
    Click    xpath=//div[text()='${InvoiceType}']
    Sleep    1s
    Take Screenshot

    # Address
    ${AddressLine1}=    Set Variable    AutomationTestAddressLine1
    Set Global Variable    ${AddressLine1}
    Verify element is visible and displayed    ${POSSalesDetails}[AddressLine1]
    Fill Text    ${POSSalesDetails}[AddressLine1]    ${AddressLine1}
    ${AddressLine2}=    Set Variable    AutomationTestAddressLine2
    Set Global Variable    ${AddressLine2}
    Verify element is visible and displayed    ${POSSalesDetails}[AddressLine2]
    Fill Text    ${POSSalesDetails}[AddressLine2]    ${AddressLine2}
    Take Screenshot
    Sleep    2s

    # Submit new customer (JS click on confirm button)
    Evaluate JavaScript    document    () => document.querySelector('button.btn.btn-app-alert-confirmation.newCust-confirm').click()
    Take Screenshot

    # Verify customer was created
    Verify element is visible and displayed    ${POSSalesDetails}[CustomerName]
    ${CustomerName}=    Get Text    ${POSSalesDetails}[CustomerName]
    Should Be Equal As Strings    ${CustomerName}    ${FirstName_generated}
    Verify element is visible and displayed    ${POSSalesDetails}[VerifyContactNumber]
    ${Number}=    Get Text    ${POSSalesDetails}[VerifyContactNumber]
    Should Be Equal As Strings    ${Number}    ${ContactNumber_generated}
    Take Screenshot

Validate the Name and Number of the Existing Customer
    Sleep    1s
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[CustomerName]
    ${CustomerName}=    Get Text    ${POSSalesDetails}[CustomerName]
    Should Be Equal As Strings    ${CustomerName}    ${FirstName_generated}
    Verify element is visible and displayed    ${POSSalesDetails}[VerifyContactNumber]
    ${Number}=    Get Text    ${POSSalesDetails}[VerifyContactNumber]
    Should Be Equal As Strings    ${Number}    ${ContactNumber_generated}
    Take Screenshot


# ---------------------------------------------------------------------------
# Product / serial number
# ---------------------------------------------------------------------------

Enter the serial number and scan
    [Documentation]    Scans serial number(s) into cart and verifies product details.
    [Arguments]    ${QuantityValue}=1    ${Validation}=NA    ${EnterOneSerialNumber}=Yes    ${RemoveAssetValidation}=Yes

    IF    '${Validation}' == 'Yes'
        Verify element is visible and displayed    ${POSSalesDetails}[Scan]
        Fill Text    ${POSSalesDetails}[Scan]    000000000
        Sleep    2s
        Take Screenshot
        Verify element is visible and displayed    ${POSSalesDetails}[AlertMessage]
        ${Message}=    Get Text    ${POSSalesDetails}[AlertMessage]
        Should Be Equal As Strings    ${Message}    Product not found
        Take Screenshot
        Sleep    2s
        Fill Text    ${POSSalesDetails}[Scan]    ${EMPTY}
    END

    IF    '${EnterOneSerialNumber}' == 'Yes'
        Verify element is visible and displayed    ${POSSalesDetails}[Scan]
        Fill Text    ${POSSalesDetails}[Scan]    ${AssetValue}
        Sleep    5s
        Verify element is visible and displayed    ${POSSalesDetails}[SerialNumber]
        ${SerialNumber}=    Get Text    ${POSSalesDetails}[SerialNumber]
        Should Be Equal As Strings    ${SerialNumber}    Serial Number: ${AssetValue}
        Verify element is visible and displayed    ${POSSalesDetails}[Quantity]
        ${Quantity}=    Get Text    ${POSSalesDetails}[Quantity]
        Should Be Equal As Strings    ${Quantity}    ${QuantityValue}
        Set Global Variable    ${QuantityValue}
        Verify element is visible and displayed    ${POSSalesDetails}[ItemPrice]
        ${ItemPrice}=    Get Text    ${POSSalesDetails}[ItemPrice]
        Set Global Variable    ${ItemPrice}
        ${ItemPriceValue}=    Replace String    ${ItemPrice}    TSH    ${EMPTY}
        Set Global Variable    ${ItemPriceValue}
    END

    IF    '${EnterOneSerialNumber}' == 'Two Serial Numbers'
        Fill Text    ${POSSalesDetails}[Scan]    ${AssetValue}
        Sleep    5s
        Fill Text    ${POSSalesDetails}[Scan]    ${AssetValue2}
        Sleep    5s
        IF    '${RemoveAssetValidation}' == 'Yes'
            Fill Text    ${POSSalesDetails}[Scan]    ${AssetValue3}
            Sleep    5s
            Verify element is visible and displayed
            ...    xpath=//span[contains(text(),'${AssetValue3}')]/ancestor::div[contains(@class,'additional-serial-row')]//span[contains(@style,'cursor: pointer')]
            Click
            ...    xpath=//span[contains(text(),'${AssetValue3}')]/ancestor::div[contains(@class,'additional-serial-row')]//span[contains(@style,'cursor: pointer')]
            Sleep    2s
            Take Screenshot
            Verify element is visible and displayed    ${POSSalesDetails}[RemoveYesButton]
            Click    ${POSSalesDetails}[RemoveYesButton]
            Sleep    2s
            Wait For Elements State
            ...    xpath=//span[contains(text(),'${AssetValue3}')]/ancestor::div[contains(@class,'additional-serial-row')]//span[contains(@style,'cursor: pointer')]
            ...    hidden    10s
            Sleep    1s
        END
        Verify element is visible and displayed    ${POSSalesDetails}[SerialNumberFirst]
        ${First}=    Get Text    ${POSSalesDetails}[SerialNumberFirst]
        Verify element is visible and displayed    ${POSSalesDetails}[SerialNumberSecond]
        ${Second}=    Get Text    ${POSSalesDetails}[SerialNumberSecond]
        ${status1}=    Run Keyword And Return Status
        ...    Should Be Equal As Strings    ${First}    Serial Number: ${AssetValue}
        ${status2}=    Run Keyword And Return Status
        ...    Should Be Equal As Strings    ${First}    Serial Number: ${AssetValue2}
        IF    not ${status1} and not ${status2}
            Fail    Serial numbers do not match expected values in any order.
        END
        Verify element is visible and displayed    ${POSSalesDetails}[Quantity]
        ${Quantity}=    Get Text    ${POSSalesDetails}[Quantity]
        Should Be Equal As Strings    ${Quantity}    ${QuantityValue}
        Set Global Variable    ${QuantityValue}
        Verify element is visible and displayed    ${POSSalesDetails}[ItemPrice]
        ${ItemPrice}=    Get Text    ${POSSalesDetails}[ItemPrice]
        Set Global Variable    ${ItemPrice}
        ${ItemPriceValue}=    Replace String    ${ItemPrice}    TSH    ${EMPTY}
        Set Global Variable    ${ItemPriceValue}
    END

Enter the Details in ERCV/Pretups Sales
    [Documentation]    Enters MSISDN and recharge amount for EVD POS sale.
    [Arguments]    ${caseID}    ${dataID}
    ${data}=          Fetch From Excel    ${Airtel_Testdata}    POSsales    ${caseID}    ${dataID}
    ${MSISDN}=        getData    ${data}    MSISDN
    ${EVDAmount}=     getData    ${data}    EVDAmount
    Set Global Variable    ${EVDAmount}
    Verify element is visible and displayed    ${POSSalesDetails}[MSISDNInput]
    Fill Text    ${POSSalesDetails}[MSISDNInput]    ${MSISDN}
    Verify element is visible and displayed    ${POSSalesDetails}[EVDAmountInput]
    Fill Text    ${POSSalesDetails}[EVDAmountInput]    ${EVDAmount}
    Take Screenshot

Store Asset from Stock View Screen
    [Documentation]    Reads the first available asset serial number from the stock view table.
    [Arguments]    ${caseID}    ${dataID}
    Verify element is visible and displayed    ${POSSalesPage}[StockViewMenu]
    Click    ${POSSalesPage}[StockViewMenu]
    Sleep    2s
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[StockViewTable]
    ${AssetValue}=    Get Text    ${POSSalesDetails}[StockViewTableFirstSerial]
    Set Global Variable    ${AssetValue}
    Take Screenshot

Verify Cash and Balance for POS EVD
    [Documentation]    Reads and stores cash register balance before/after EVD sale.
    [Arguments]    ${caseID}    ${dataID}    ${CheckPoint}=Before POS EVD
    Verify element is visible and displayed    ${POSSalesPage}[CashRegisterMenu]
    Click    ${POSSalesPage}[CashRegisterMenu]
    Sleep    2s
    Take Screenshot
    IF    '${CheckPoint}' == 'Before POS EVD'
        ${CashBalance}=    Get Text    ${POSSalesDetails}[CashBalance]
        Set Global Variable    ${CashBalance}
    END
    IF    '${CheckPoint}' == 'After POS EVD'
        ${CashBalanceAfter}=    Get Text    ${POSSalesDetails}[CashBalance]
        Set Global Variable    ${CashBalanceAfter}
    END
    Take Screenshot


# ---------------------------------------------------------------------------
# Payment
# ---------------------------------------------------------------------------

Verify the Payment Options
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[PaymentOptionCash]
    Verify element is visible and displayed    ${POSSalesDetails}[PaymentOptionCheque]
    Verify element is visible and displayed    ${POSSalesDetails}[PaymentOptionCreditCard]
    Verify element is visible and displayed    ${POSSalesDetails}[PaymentOptionBankTransfer]
    Verify element is visible and displayed    ${POSSalesDetails}[PaymentOptionAIRTELMONEY/MobileMoney]
    Take Screenshot

Choose Payment Method And Submit
    [Documentation]    Selects payment method, fills payment details, submits POS sale and verifies order summary.
    [Arguments]    ${caseID}    ${dataID}    ${PaymentMethod}=Cash    ${CashFromExcel}=NA
    ...    ${MultipleProduct}=NA    ${ChooseMethod}=NA    ${CashValidation}=Normal
    ${data}=              Fetch From Excel    ${Airtel_Testdata}    POSsales    ${caseID}    ${dataID}
    ${BankName}=          getData    ${data}    BankName
    ${BankCode}=          getData    ${data}    BankCode
    ${TransactionID}=     getData    ${data}    TransactionID
    ${AirtelMoneyAmount}= getData    ${data}    AirtelMoneyAmount
    Set Global Variable    ${TransactionID}

    # Determine cash amount
    IF    '${CashFromExcel}' == 'Yes'
        ${CashAmount}=    getData    ${data}    CashAmount
        Set Global Variable    ${CashAmount}
    END
    IF    '${CashFromExcel}' == 'NA'
        ${CashAmount}=    Set Variable    ${ItemPriceValue}
        Set Global Variable    ${CashAmount}
    END
    IF    '${CashFromExcel}' == 'Split'
        ${Amount1}=    Evaluate    format(round(float(str("${ItemPriceValue}").replace(',', '')) / 2, 2), '.2f')
        ${Amount2}=    Set Variable    ${Amount1}
        Set Global Variable    ${Amount1}
        Set Global Variable    ${Amount2}
        ${CashAmount}=    Set Variable    ${Amount1}
        Set Global Variable    ${CashAmount}
    END
    ${CashAmount}=        Convert To String    ${CashAmount}
    ${CashAmountInput}=   Replace String    ${CashAmount}    ,    ${EMPTY}
    Take Screenshot

    # --- Cash ---
    IF    '${PaymentMethod}' == 'Cash'
        Click    ${POSSalesDetails}[PaymentOptionCash]
        Sleep    1s
        Take Screenshot
        Verify element is visible and displayed    ${POSSalesDetails}[CashAmount]
        Set Global Variable    ${CashAmountInput}
        Fill Text    ${POSSalesDetails}[CashAmount]    ${CashAmountInput}
        Sleep    1s
        Click    ${POSSalesDetails}[BankCodeCash]
        Sleep    1s
        Keyboard Key    press    Enter
        Sleep    1s
        Verify element is visible and displayed    ${POSSalesDetails}[AddButton]
        Click    ${POSSalesDetails}[AddButton]
        Sleep    1s
        Take Screenshot
        Verify element is visible and displayed    ${POSSalesDetails}[VerifyAmount]
        ${Amount}=    Get Text    ${POSSalesDetails}[VerifyAmount]
        IF    '${CashValidation}' == 'Normal'
            Should Contain    ${Amount}    ${CashAmount}
        END
        IF    '${CashValidation}' == 'Multiple Payment'
            ${AmountVal}=    Replace String    ${Amount}    ,    ${EMPTY}
            Should Contain    ${AmountVal}    ${CashAmount}
        END
        Set Global Variable    ${Amount}
        ${Method}=    Get Text    ${POSSalesDetails}[VerifyMethod]
        Should Be Equal As Strings    ${Method}    ${PaymentMethod}
    END

    # --- Cheque (second payment method) ---
    IF    '${ChooseMethod}' == 'Cheque'
        Click    ${POSSalesDetails}[PaymentOptionCheque]
        Sleep    1s
        Take Screenshot
        Click    ${POSSalesDetails}[ChequeDate]
        Sleep    1s
        Keyboard Key    press    Enter
        Sleep    1s
        Click    ${POSSalesDetails}[BankName]
        Sleep    1s
        Verify element is visible and displayed    xpath=//div[@id='sixdee_single_selectfield_bankName']//div[text()='${BankName}']
        Click    xpath=//div[@id='sixdee_single_selectfield_bankName']//div[text()='${BankName}']
        Sleep    2s
        Click    ${POSSalesDetails}[BankCode]
        Sleep    1s
        Verify element is visible and displayed    xpath=//div[@id='sixdee_field_infinite_select_bankCode']//div[text()='${BankCode}']
        Click    xpath=//div[@id='sixdee_field_infinite_select_bankCode']//div[text()='${BankCode}']
        Sleep    2s
        Fill Text    ${POSSalesDetails}[PayeeName]    ${CustomerName_generated}
        Fill Text    ${POSSalesDetails}[ChequeAmount]    ${Amount2}
        ${RandomNumber}=          Generate Random String    6    012345689
        ${ChequeNumber_generated}=    Catenate    SEPARATOR=    200    ${RandomNumber}
        Set Global Variable    ${ChequeNumber_generated}
        Fill Text    ${POSSalesDetails}[ChequeNumber]    ${ChequeNumber_generated}
        Click    ${POSSalesDetails}[AddButton]
        Sleep    1s
        Take Screenshot
        ${Amount}=    Get Text    ${POSSalesDetails}[VerifyAmountSecond]
        ${AmountVal}=    Replace String    ${Amount}    ,    ${EMPTY}
        Should Contain    ${AmountVal}    ${CashAmount}
        Set Global Variable    ${Amount}
        ${Method}=    Get Text    ${POSSalesDetails}[VerifyMethodSecond]
        Should Be Equal As Strings    ${Method}    ${ChooseMethod}
    END

    # --- Airtel Money (second payment method) ---
    IF    '${ChooseMethod}' == 'AIRTEL MONEY/Mobile Money'
        Click    ${POSSalesDetails}[PaymentOptionAIRTELMONEY/MobileMoney]
        Sleep    1s
        Take Screenshot
        Fill Text    ${POSSalesDetails}[TransactionID]    ${TransactionID}
        Sleep    5s
        Fill Text    ${POSSalesDetails}[TransactionAmount]    ${AirtelMoneyAmount}
        Sleep    2s
        Click    ${POSSalesDetails}[ValidateButton]
        Sleep    1s
        Take Screenshot
        ${Msg}=    Get Text    ${POSSalesDetails}[ValidationMsg]
        Should Be Equal As Strings    ${Msg}    Transaction validated successfully.
        Click    ${POSSalesDetails}[AddButton]
        Sleep    1s
        Take Screenshot
        ${Amount}=    Get Text    ${POSSalesDetails}[VerifyAmount]
        Set Global Variable    ${Amount}
        ${Method}=    Get Text    ${POSSalesDetails}[VerifyMethod]
        Should Be Equal As Strings    ${Method}    ${PaymentMethod}

        ${ValueAmount}=    Evaluate    float(str('${ItemPrice}').replace('TSH','').replace(',',''))
        ${AIRTEL_MONEY_Total_Val}=    Evaluate    float('${Amount}'.replace('TSH',''))
        Set Global Variable    ${AIRTEL_MONEY_Total_Val}
        ${is_less}=    Run Keyword And Return Status    Evaluate    ${AIRTEL_MONEY_Total_Val} < ${ValueAmount}
        Set Global Variable    ${is_less}
        IF    ${is_less}
            ${difference}=    Evaluate    "{:.2f}".format(${ValueAmount} - ${AIRTEL_MONEY_Total_Val})
            Set Global Variable    ${difference}
            Click    ${POSSalesDetails}[PaymentOptionCash]
            Sleep    1s
            Fill Text    ${POSSalesDetails}[CashAmount]    ${difference}
            Click    ${POSSalesDetails}[BankCodeCash]
            Sleep    1s
            Keyboard Key    press    Enter
            Sleep    1s
            Click    ${POSSalesDetails}[AddButton]
            Sleep    1s
            Take Screenshot
            ${Value}=    Get Text    ${POSSalesDetails}[VerifyAmountSecond]
            ${AmountVal}=    Replace String    ${Value}    ,    ${EMPTY}
            Should Contain    ${AmountVal}    ${difference}
            Set Global Variable    ${difference}
            ${CashAmount}=    Set Variable    ${difference}
            Set Global Variable    ${CashAmount}
            ${Method}=    Get Text    ${POSSalesDetails}[VerifyMethodSecond]
            Should Be Equal As Strings    ${Method}    Cash
        END
    END

    # --- Submit order ---
    Verify element is visible and displayed    ${POSSalesDetails}[SubmitButton]
    Click    ${POSSalesDetails}[SubmitButton]
    Sleep    1s
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[OrderTableValue2nd]
    ${Number}=    Get Text    ${POSSalesDetails}[OrderTableValue2nd]
    Should Contain    ${Number}    ${AssetValue}
    IF    '${MultipleProduct}' == 'Yes'
        Should Contain    ${Number}    ${AssetValue2}
    END
    ${Quantity}=    Get Text    ${POSSalesDetails}[OrderTableValue3rd]
    Should Be Equal As Strings    ${Quantity}    Qty: ${QuantityValue}
    ${AmountValue}=    Get Text    ${POSSalesDetails}[OrderTableValue4th]
    Should Be Equal As Strings    ${AmountValue}    ${ItemPrice}
    ${TotalValue}=    Get Text    ${POSSalesDetails}[TotalValue]
    Set Global Variable    ${TotalValue}
    ${Cash}=    Get Text    ${POSSalesDetails}[PaymentDetailsCash]
    IF    '${CashValidation}' == 'Normal'
        Should Contain    ${Cash}    ${CashAmount}
    END
    IF    '${CashValidation}' == 'Multiple Payment'
        ${CashVal}=    Replace String    ${Cash}    ,    ${EMPTY}
        Should Contain    ${CashVal}    ${CashAmount}
    END
    IF    '${ChooseMethod}' == 'Cheque'
        ${Cash}=    Get Text    ${POSSalesDetails}[PaymentDetailsCheque]
        ${CashVal}=    Replace String    ${Cash}    ,    ${EMPTY}
        Should Contain    ${CashVal}    ${Amount2}
    END
    IF    '${ChooseMethod}' == 'AIRTEL MONEY/Mobile Money'
        ${Cash}=    Get Text    ${POSSalesDetails}[PaymentDetailsAirtelMoney]
        ${AIRTEL_MONEY_Total_Val}=    Convert To String    ${AIRTEL_MONEY_Total_Val}
        Should Contain    ${Cash}    ${AIRTEL_MONEY_Total_Val}
    END

    # Final confirm and verify order receipt
    Click    ${POSSalesDetails}[SubmitAndProcess]
    Sleep    1s
    Take Screenshot
    Click    ${POSSalesDetails}[ConfirmSubmit]
    Sleep    5s
    Take Screenshot
    ${CustomerID}=    Get Text    ${POSSalesDetails}[CustomerID]
    Set Global Variable    ${CustomerID}
    Take Screenshot
    ${Name}=    Get Text    ${POSSalesDetails}[CustomerDetailsName]
    Should Be Equal As Strings    ${Name}    ${FirstName_generated}
    ${Email}=    Get Text    ${POSSalesDetails}[CustomerDetailsEmail]
    Should Be Equal As Strings    ${Email}    ${EmailId_generated}
    ${Number}=    Get Text    ${POSSalesDetails}[CustomerDetailsNumber]
    Should Be Equal As Strings    ${Number}    ${ContactNumber_generated}
    ${TotalPrice}=    Get Text    ${POSSalesDetails}[TotalPrice]
    Should Be Equal As Strings    ${TotalPrice}    ${TotalValue}
    ${Order ID}=    Get Text    ${POSSalesDetails}[GetOrderID]
    Set Global Variable    ${Order ID}
    Sleep    2s
    Click    ${POSSalesDetails}[Close]
    Sleep    1s
    Take Screenshot
    Click    ${POSSalesDetails}[BackMenu]
    Sleep    1s
    Take Screenshot

Choose Payment Method And Recharge
    [Documentation]    Payment + recharge for EVD POS sale.
    [Arguments]    ${caseID}    ${dataID}    ${PaymentMethod}=Cash    ${CashFromExcel}=NA
    ...    ${ChooseMethod}=NA    ${BulkUpload}=NA
    ${data}=          Fetch From Excel    ${Airtel_Testdata}    POSsales    ${caseID}    ${dataID}
    ${BankName}=      getData    ${data}    BankName
    ${BankCode}=      getData    ${data}    BankCode
    ${TransactionID}= getData    ${data}    TransactionID
    Set Global Variable    ${TransactionID}

    IF    '${CashFromExcel}' == 'Yes'
        ${CashAmount}=    getData    ${data}    CashAmount
        Set Global Variable    ${CashAmount}
    END
    IF    '${CashFromExcel}' == 'ForPOSEVD'
        ${CashAmount}=    Set Variable    ${EVDAmount}
        Set Global Variable    ${CashAmount}
    END
    IF    '${CashFromExcel}' == 'Split'
        ${Amount1}=    Evaluate    format(round(float(${EVDAmount}) / 2, 2), '.2f')
        ${Amount2}=    Set Variable    ${Amount1}
        Set Global Variable    ${Amount1}
        Set Global Variable    ${Amount2}
        ${CashAmount}=    Set Variable    ${Amount1}
        Set Global Variable    ${CashAmount}
    END
    ${CashAmount}=    Convert To String    ${CashAmount}
    Take Screenshot

    IF    '${PaymentMethod}' == 'Cash'
        Click    ${POSSalesDetails}[PaymentOptionCash]
        Sleep    1s
        Take Screenshot
        Verify element is visible and displayed    ${POSSalesDetails}[CashAmount]
        Fill Text    ${POSSalesDetails}[CashAmount]    ${CashAmount}
        Sleep    1s
        Click    ${POSSalesDetails}[ReturnBankCodeCash]
        Sleep    1s
        Keyboard Key    press    Enter
        Sleep    1s
        Click    ${POSSalesDetails}[AddButton]
        Sleep    1s
        Take Screenshot
        ${Amount}=    Get Text    ${POSSalesDetails}[VerifyAmount]
        ${Amount}=    Evaluate    '${Amount}'.replace('TSH', '').replace(',', '').strip()
        Should Contain    ${Amount}    ${CashAmount}
        Set Global Variable    ${Amount}
        ${Method}=    Get Text    ${POSSalesDetails}[VerifyMethod]
        Should Be Equal As Strings    ${Method}    ${PaymentMethod}
    END

    IF    '${ChooseMethod}' == 'AIRTEL MONEY/Mobile Money'
        Click    ${POSSalesDetails}[PaymentOptionAIRTELMONEY/MobileMoney]
        Sleep    1s
        Take Screenshot
        Fill Text    ${POSSalesDetails}[TransactionID]    ${TransactionID}
        Sleep    5s
        Click    ${POSSalesDetails}[AddButton]
        Sleep    1s
        Take Screenshot
        ${Amount}=    Get Text    ${POSSalesDetails}[VerifyAmount]
        Set Global Variable    ${Amount}
        ${Method}=    Get Text    ${POSSalesDetails}[VerifyMethod]
        Should Be Equal As Strings    ${Method}    ${PaymentMethod}

        ${ValueAmount}=    Evaluate    float('${EVDAmount}'.replace('TSH',''))
        ${AIRTEL_MONEY_Total_Val}=    Evaluate    float('${Amount}'.replace('TSH',''))
        Set Global Variable    ${AIRTEL_MONEY_Total_Val}
        ${is_less}=    Run Keyword And Return Status    Evaluate    ${AIRTEL_MONEY_Total_Val} < ${ValueAmount}
        Set Global Variable    ${is_less}
        IF    ${is_less}
            ${difference}=    Evaluate    "{:.2f}".format(${ValueAmount} - ${AIRTEL_MONEY_Total_Val})
            Set Global Variable    ${difference}
            Click    ${POSSalesDetails}[PaymentOptionCash]
            Sleep    1s
            Fill Text    ${POSSalesDetails}[CashAmount]    ${difference}
            Click    ${POSSalesDetails}[BankCodeCash]
            Sleep    1s
            Keyboard Key    press    Enter
            Sleep    1s
            Click    ${POSSalesDetails}[AddButton]
            Sleep    1s
            Take Screenshot
            ${Value}=    Get Text    ${POSSalesDetails}[VerifyAmountSecond]
            Should Contain    ${Value}    ${difference}
            Set Global Variable    ${difference}
            ${CashAmount}=    Set Variable    ${difference}
            Set Global Variable    ${CashAmount}
            ${Method}=    Get Text    ${POSSalesDetails}[VerifyMethodSecond]
            Should Be Equal As Strings    ${Method}    Cash
        END
    END

    # Recharge and submit
    Click    ${POSSalesDetails}[Recharge]
    Sleep    1s
    Take Screenshot
    Click    ${POSSalesDetails}[SubmitButton]
    Sleep    1s
    Take Screenshot

    IF    '${BulkUpload}' == 'NA'
        ${CustomerID}=    Get Text    ${POSSalesDetails}[EVDCustomerID]
        Set Global Variable    ${CustomerID}
        Take Screenshot
        ${Name}=    Get Text    ${POSSalesDetails}[CustomerDetailsName]
        Should Be Equal As Strings    ${Name}    ${FirstName_generated}
        ${Email}=    Get Text    ${POSSalesDetails}[CustomerDetailsEmail]
        Should Be Equal As Strings    ${Email}    ${EmailId_generated}
        ${Number}=    Get Text    ${POSSalesDetails}[CustomerDetailsNumber]
        Should Be Equal As Strings    ${Number}    ${ContactNumber_generated}
        ${TotalValue}=    Get Text    ${POSSalesDetails}[TotalPrice]
        ${EVDAmount}=    Convert To String    ${EVDAmount}
        Should Contain    ${TotalValue}    ${EVDAmount}
        Set Global Variable    ${TotalValue}
        ${Order ID}=    Get Text    ${POSSalesDetails}[EVDOrderID]
        Set Global Variable    ${Order ID}
        Sleep    2s
        Click    ${POSSalesDetails}[Close]
        Sleep    1s
        Take Screenshot
        Click    ${POSSalesDetails}[BackMenu]
        Sleep    1s
        Take Screenshot
    END
    IF    '${BulkUpload}' == 'Duplicate MSISDN'
        Verify element is visible and displayed    ${POSSalesDetails}[DuplicateMSISDN]
        ${Message}=    Get Text    ${POSSalesDetails}[DuplicateMSISDN]
        Should Be Equal As Strings    ${Message}    File has duplicate records
    END
    IF    '${BulkUpload}' == 'EmptyFile'
        Verify element is visible and displayed    ${POSSalesDetails}[EmptyFile]
        ${Message}=    Get Text    ${POSSalesDetails}[EmptyFile]
        Should Be Equal As Strings    ${Message}    Transfer amount provided is not matching with amount from file
    END


# ---------------------------------------------------------------------------
# EVD Bulk Upload
# ---------------------------------------------------------------------------

Upload EVD Bulk File
    [Arguments]    ${FilePath}
    Verify element is visible and displayed    ${POSSalesDetails}[BulkUploadInput]
    Upload File By Selector    ${POSSalesDetails}[BulkUploadInput]    ${FilePath}
    Sleep    3s
    Take Screenshot

Validation for Cash and Change value
    [Documentation]    Verifies cash register change/balance after POS sale.
    [Arguments]    ${caseID}    ${dataID}
    ${data}=        Fetch From Excel    ${Airtel_Testdata}    POSsales    ${caseID}    ${dataID}
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[CashRegisterTable]
    Take Screenshot


# ---------------------------------------------------------------------------
# Order search and verification
# ---------------------------------------------------------------------------

Search the created Sale Order
    [Arguments]    ${Order}=Create
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[SearchCreatedValue]
    Click    ${POSSalesDetails}[SearchCreatedValue]
    Sleep    1s
    Fill Text    ${POSSalesDetails}[InputSearch]    ${Order ID}
    Sleep    1s
    Take Screenshot
    ${count}=    Get Element Count    ${POSSalesDetails}[Table]
    ${count}=    Evaluate    ${count} + 1
    FOR    ${index}    IN RANGE    1    ${count}
        ${Order ID Value}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[1]
        IF    '${Order ID Value}' == '${Order ID}'
            IF    '${Order}' == 'Create'
                ${OrderType}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[5]
                Should Be Equal As Strings    ${OrderType}    POS_ORD
                ${Invoice Status}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[10]
                Should Be Equal As Strings    ${Invoice Status}    GENERATED
                ${Invoice ID}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[7]
                Set Global Variable    ${Invoice ID}
            END
            IF    '${Order}' == 'Return'
                ${OrderType}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[5]
                Should Be Equal As Strings    ${OrderType}    PRV_ORD
                ${Invoice Status}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[10]
                Should Be Equal As Strings    ${Invoice Status}    GENERATED
                ${Invoice ID}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[7]
                Set Global Variable    ${Invoice ID}
            END
            IF    '${Order}' == 'Replace'
                ${OrderType}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[5]
                Should Be Equal As Strings    ${OrderType}    PRP_ORD
                ${Invoice ID}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[7]
            END
            ${CustomerNameValue}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[6]
            Should Be Equal As Strings    ${CustomerNameValue}    ${CustomerName_generated}
            ${Order Status}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[9]
            Should Be Equal As Strings    ${Order Status}    COMPLETED
            Hover    xpath=//table[@role='table']/tbody/tr[${index}]//td[8]
            Sleep    5s
            Take Screenshot
            Hover    xpath=//table[@role='table']/tbody/tr[${index}]//td[12]
            Sleep    1s
            Take Screenshot
            Click    ${POSSalesDetails}[InfoIcon]
            Sleep    1s
            Take Screenshot
        END
        Exit For Loop If    '${Order ID Value}' == '${Order ID}'
    END
    Should Be Equal As Strings    ${Order ID Value}    ${Order ID}
    IF    '${Order}' == 'Create' or '${Order}' == 'Return'
        Verify element is visible and displayed    ${POSSalesDetails}[StatusCompleted]
    END

Search the created Sale Order for POS EVD
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[SearchCreatedValue]
    Click    ${POSSalesDetails}[SearchCreatedValue]
    Sleep    1s
    Fill Text    ${POSSalesDetails}[InputSearch]    ${Order ID}
    Sleep    1s
    Take Screenshot
    ${count}=    Get Element Count    ${POSSalesDetails}[Table]
    ${count}=    Evaluate    ${count} + 1
    FOR    ${index}    IN RANGE    1    ${count}
        ${Order ID Value}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[1]
        IF    '${Order ID Value}' == '${Order ID}'
            ${CustomerType}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[5]
            Should Be Equal As Strings    ${CustomerType}    END_CUSTOMER
            ${Invoice Status}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[9]
            Should Be Equal As Strings    ${Invoice Status}    GENERATED
            ${Invoice ID}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[6]
            Set Global Variable    ${Invoice ID}
            ${CustomerNameValue}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[4]
            Should Be Equal As Strings    ${CustomerNameValue}    ${CustomerName_generated}
            ${Order Status}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[8]
            Should Be Equal As Strings    ${Order Status}    COMPLETED
            ${Order Amount}=    Get Text    xpath=//table[@role='table']/tbody/tr[${index}]//td[7]
            Should Be Equal As Strings    ${Order Amount}    ${TotalValue}
            Take Screenshot
            Hover    xpath=//table[@role='table']/tbody/tr[${index}]//td[11]
            Sleep    1s
            Take Screenshot
            Click    ${POSSalesDetails}[InfoIcon]
            Sleep    1s
            Take Screenshot
        END
        Exit For Loop If    '${Order ID Value}' == '${Order ID}'
    END
    Should Be Equal As Strings    ${Order ID Value}    ${Order ID}
    Verify element is visible and displayed    ${POSSalesDetails}[StatusCompleted]

Verify the created Sale Order
    [Arguments]    ${Actions}=POS Sale
    ${CustomerIDVal}=    Get Text    ${POSSalesDetails}[OrderViewCustomerID]
    Should Be Equal As Strings    ${CustomerIDVal}    ${CustomerID}
    ${Name}=    Get Text    ${POSSalesDetails}[OrderViewName]
    Should Be Equal As Strings    ${Name}    ${FirstName_generated}
    ${Email}=    Get Text    ${POSSalesDetails}[OrderViewEmail]
    Should Be Equal As Strings    ${Email}    ${EmailId_generated}
    ${Number}=    Get Text    ${POSSalesDetails}[OrderViewNumber]
    Should Be Equal As Strings    ${Number}    ${ContactNumber_generated}
    ${TotalPrice}=    Get Text    ${POSSalesDetails}[GrandTotal]
    Should Be Equal As Strings    ${TotalPrice}    ${TotalValue}
    Take Screenshot
    Click    ${POSSalesDetails}[Actions]
    Sleep    1s
    Take Screenshot
    IF    '${Actions}' == 'POS Sale'
        Verify element is visible and displayed    ${POSSalesDetails}[ReturnItem]
        Verify element is visible and displayed    ${POSSalesDetails}[ReplaceItem]
    END
    Verify element is visible and displayed    ${POSSalesDetails}[TrackOrder]
    Verify element is visible and displayed    ${POSSalesDetails}[DownloadInvoice]
    Verify element is visible and displayed    ${POSSalesDetails}[DownloadPaymentReceipt]

Verify the status of Suborders
    [Arguments]    ${TrackOrder}=POS Sale
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[TrackOrder]
    Click    ${POSSalesDetails}[TrackOrder]
    Sleep    1s
    Take Screenshot
    Sleep    5s
    Verify element is visible and displayed    ${POSSalesDetails}[TableValueFirstRow1]
    ${SuborderID1}=    Get Text    ${POSSalesDetails}[TableValueFirstRow1]
    Set Global Variable    ${SuborderID1}
    ${Category1}=    Get Text    ${POSSalesDetails}[TableValueFirstRow2]
    Should Be Equal As Strings    ${Category1}    pos-sales-erp-invoice-posting
    ${status1}=    Get Text    ${POSSalesDetails}[TableValueFirstRow3]
    Should Be Equal As Strings    ${status1}    Completed
    ${SuborderID2}=    Get Text    ${POSSalesDetails}[TableValueSecondRow1]
    Set Global Variable    ${SuborderID2}
    ${Category2}=    Get Text    ${POSSalesDetails}[TableValueSecondRow2]
    Should Be Equal As Strings    ${Category2}    pos-sales-RA-integration
    ${status2}=    Get Text    ${POSSalesDetails}[TableValueSecondRow3]
    Should Be Equal As Strings    ${status2}    Completed
    IF    '${TrackOrder}' == 'POS Sale'
        ${SuborderID3}=    Get Text    ${POSSalesDetails}[TableValueThirdRow1]
        Set Global Variable    ${SuborderID3}
        ${Category3}=    Get Text    ${POSSalesDetails}[TableValueThirdRow2]
        Should Be Equal As Strings    ${Category3}    esb-inventory-posting
        ${status3}=    Get Text    ${POSSalesDetails}[TableValueThirdRow3]
        Should Be Equal As Strings    ${status3}    Completed
    END
    Take Screenshot
    Click    ${POSSalesDetails}[CloseInfo]
    Sleep    1s
    Take Screenshot


# ---------------------------------------------------------------------------
# Invoice and payment receipt download
# ---------------------------------------------------------------------------

Verify Invoice after placing a POS Sale order
    Take Screenshot
    Click    ${POSSalesDetails}[Actions]
    Sleep    1s
    Take Screenshot
    Click    ${POSSalesDetails}[DownloadInvoice]
    Sleep    3s
    Take Screenshot
    ${file}=    Download should be done    ${download directory}
    Rename Downloaded Tmp File To Required Format    ${download directory}
    Take Screenshot

Verify Payment Receipt Generated after placing a POS Sale order
    Take Screenshot
    Click    ${POSSalesDetails}[Actions]
    Sleep    1s
    Take Screenshot
    Click    ${POSSalesDetails}[DownloadPaymentReceipt]
    Sleep    3s
    Take Screenshot
    ${file}=    Download should be done    ${download directory}
    Rename Downloaded Tmp File To Required Format    ${download directory}
    Take Screenshot

Verify Invoice Generation Is Not Visible
    Click    ${POSSalesDetails}[Actions]
    Sleep    1s
    Take Screenshot
    Verify element is visible and displayed    ${POSSalesDetails}[TrackOrder]
    Wait For Elements State    ${POSSalesDetails}[DownloadInvoice]    hidden    5s


# ---------------------------------------------------------------------------
# Return / Replace flow
# ---------------------------------------------------------------------------

Initiate Return Order
    [Arguments]    ${caseID}    ${dataID}    ${ReturnType}=Good
    ${data}=        Fetch From Excel    ${Airtel_Testdata}    POSsales    ${caseID}    ${dataID}
    Click    ${POSSalesDetails}[ReturnItem]
    Sleep    2s
    Take Screenshot

Initiate Replace Order
    [Arguments]    ${caseID}    ${dataID}
    Click    ${POSSalesDetails}[ReplaceItem]
    Sleep    2s
    Take Screenshot
