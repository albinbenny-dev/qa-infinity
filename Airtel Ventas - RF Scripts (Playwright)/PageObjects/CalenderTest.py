import PyPDF2
import csv
import functools
import openpyxl
import os
import zipfile
from calendar import monthrange


def days_in_month(year: int, month: int):
    print("year: {}, month: {}".format(year, month))
    if month in {1, 3, 5, 7, 8, 10, 12}:
        return 31
    if month == 2:
        if leap_year(year):
            return 29
        return 28
    return 30


def leap_year(year):
    if year % 400 == 0:
        return True
    if year % 100 == 0:
        return False
    if year % 4 == 0:
        return True
    return False


def number_of_days_in_month(year: int, month: int):
    return monthrange(year, month)[1]


def validate_billing_invoice(filepath: str, count=None, amount=None, ratezone=None):
    rows = []
    with open(filepath, 'r') as csvfile:
        csvreader = csv.reader(csvfile)
        for row in csvreader:
            rows.append(row)
    for row in rows:
        if row[0] == 'NB-IOT':
            print(row)
            print(row[1] + ' ' + count)
            print(row[2])
            amount = str(amount).replace('€ ', '')
            print(int(float(amount)))
            print(str(int(float(row[2]))) + ' ' + str(int(float(amount))))
            print(row[3] + ' ' + ratezone)
            if row[1].__eq__(count) and str(int(float(row[2]))).__eq__(str(int(float(amount)))) \
                    and row[3].__eq__(ratezone):
                print('NB-IOT Data verified')
            else:
                print('NB-IOT Data not Matching')


def validate_accural_file(filepath: str, ratezone, tariffprice):
    fields = []
    rows = []

    with open(filepath, 'r') as csvfile:
        csvreader = csv.reader(csvfile)
        fields = next(csvreader)
        for row in csvreader:
            rows.append(row)
        print("Total no. of rows: %d" % csvreader.line_num)
    print('Field names are:' + ', '.join(field for field in fields))
    field = [row for field in fields]
    columns = str(field[0]).split(";")
    print(columns)
    str1 = 'NB-IoT Usage in  - '
    res = {}
    for row in rows:
        temp = row.__str__().split(';')
        for txt in temp:
            if txt.__eq__(str1 + ratezone):
                res = {columns[i]: temp[i] for i in range(len(columns))}
                break
    if str(res.get('Settlement product')).__eq__('32I-MVNENBIOT_R') \
            and str(res.get('Unit tariff')).__eq__(tariffprice) \
            and str(res.get('Description for account line')).__eq__(str1 + ratezone):
        print("NB-IOT Data verified")
    else:
        print("NB-IOT data's not matching")


def validate_file(filepath: str, successInd):
    file1 = open(filepath, 'r')
    # for line in file1:
    #     # add validations for the file contents
    #     if ',' in line:
    #         print("comma found")
    lines = file1.readlines()
    header = "ICCID,IMSI,status,error reason,transferror,transferoree,timestamp"  # hardcode the header values
    lines = [line.rstrip() for line in lines]
    print(lines)
    lines[0].__eq__("SUCCESS")
    lines[1].__eq__(header)
    if ',' in lines[1]:
        print("comma found")
    if successInd > 0:
        if ',' in lines[2]:
            print("comma found")
        lines[3].__eq__("FAILURE")
        lines[4].__eq__(header)
    else:
        lines[2].__eq__("FAILURE")
        lines[3].__eq__(header)
        if 'FAILED' in lines[4] and 'Test Plan associated with SIM is not included in Destination Transfer Account' in \
                lines[4]:
            print('Failed Reason : Test Plan associated with SIM is not included in Destination Transfer Account')
        elif 'FAILED' in lines[4] and 'Transferee Account Id And Transferor Account Id Can not be same' in \
                lines[4]:
            print('Failed Reason : Transferee Account Id And Transferor Account Id Can not be same')
        else:
            print('NO error message found')
        # lines[4].__eq__(values)


def validate_generate_billing_file(filepath: str, accounts: str = None):
    rows = []
    with open(filepath, 'r') as csvfile:
        csvreader = csv.reader(csvfile)
        fields = next(csvreader)
        for row in csvreader:
            rows.append(row)
        print("Total no. of rows: %d" % csvreader.line_num)
    print('Field names are:' + ', '.join(field for field in fields))
    if ',' in fields:
        print("comma found")
    field = [row for field in fields]
    print(field)
    accountList = []
    if accounts:
        accountList = accounts.split(",")
    for elm in rows:
        if elm == 'Account ID':
            print("Account Id Found")
        if elm == 'Account Name':
            print("Account Name Found")
        if elm == 'Status':
            print("Status Found")
        if elm == 'Customer No':
            print("Customer No Found")
        if elm == 'Type':
            print("Type Found")
        if elm == 'Currency':
            print("Currency Found")
        if elm == 'Charging Category':
            print("Charging Category Found")
        if elm == 'Fee Category':
            print("Fee Category Found")
        if elm == 'Charging date':
            print("Charging Date Found")
        if elm == 'Name':
            print("Name Found")
        if elm == 'Description':
            print("Description Found")
        if elm == 'Amount':
            print("Amount Found")
        if elm == 'Recurrence':
            print("Recurrence Found")
        if elm == 'Activated by':
            print("Activated by Found")
        if elm == 'Ratezone':
            print("Ratezone Found")
        if elm == 'SIM & Benefit Fee':
            print("SIM & Benefit Fee Found")
        if elm == 'No of SIMs':
            print("No of SIMs Found")
        if elm == 'Price per SIM':
            print("Price per SIM Found")
        if elm == 'Price per Threshold':
            print("Price per Threshold Found")
        if elm == 'Volume(MB) in Benefit':
            print("Volume(MB) in Benefit Found")
        if elm == 'Volume(MB)':
            print("Volume(MB) Found")
        if elm == 'Price per unit':
            print("Price per unit Found")
        if elm == 'Unit':
            print("unit Found")
        if elm == 'No of SMS in Benefit':
            print("No of SMS in Benefit Found")
        if elm == 'No of SMS':
            print("No of SMS Found")
        if elm == 'Price per SMS':
            print("Price per SMS Found")
        if elm == 'No of Networks':
            print("No of Networks Found")
        if elm == 'Price per Network':
            print("Price per Network Found")
        if elm == 'Sub - total':
            print("Sub - total Found")
        if elm == 'Total':
            print("Total Found")
        if elm == "OneTime" or elm == "Recurring":
            print("Mode is either OneTime or Recurring")
        for account in accountList:
            if elm == account:
                print("Data for " + elm + " present")


def validate_billing_pdf_files(filepath: str, filenameprefix: str = None):
    pdfFileObj = open(filepath, 'rb')
    pdfReader = PyPDF2.PdfFileReader(pdfFileObj)
    pageNum = pdfReader.numPages
    print('No of Pages: ' + str(pageNum))
    for page in range(pageNum):
        pageObj = pdfReader.getPage(page)

        pageContent: str = pageObj.extractText()
        print(pageContent)
        if "Billing Details" in pageContent and "Bill Period" in pageContent:
            print("Header verified")
        if "Account ID" in pageContent and "Account Name" in pageContent and "Status" in pageContent and \
                "Customer No" in pageContent and "Type" in pageContent and "Currency" in pageContent \
                and "Country" in pageContent:
            print("Customer Information Verified")
        if "One Time Fees" in pageContent or "Recurring Fees" in pageContent or "Benefits" in pageContent \
                or "Services" in pageContent or "SIM Based Fees" in pageContent or "Minimum Fee" in pageContent \
                or "Total Billed Amount" in pageContent:
            print("Billing Summary Verified")
        if filenameprefix != None:
            temp = filenameprefix.split("_")
            accountname = temp[0]
            accountid = temp[1]
            if (accountname in pageContent and accountid in pageContent):
                print("accountname and accountid verified")
    pdfFileObj.close()


def extract_zip_files(directory: str, filename):
    print(directory)
    with zipfile.ZipFile(filename, 'r') as zip_ref:
        list_filenames = zip_ref.namelist()
        # for filename in list_filenames:
        #     if filename.endswith('.pdf'):
        #         zip_ref.extract(directory)
        #         return filename
        filename = zip_ref.printdir()
        print('Extracting all the files now...')
        zip_ref.extractall()
        return list_filenames[0]


def validate_csv(filepath: str):
    rows = []
    with open(filepath, 'r') as csvfile:
        reader = csv.reader(csvfile)
        fields = next(reader)
        for row in reader:
            rows.append(row)
            print(row[2])


def validate_excel(filepath: str, type):
    vk = openpyxl.load_workbook(filepath)
    sheet = vk.active
    print(sheet)
    print(sheet['C3'].value)
    clvalue = sheet['C3'].value
    if clvalue == 'Operator':
        print("Operator Report")
    if clvalue == 'APN':
        print("Operator Report")
    if clvalue == 'Plan Name':
        print("Plan Report")
    if clvalue == 'Country':
        print("Country Report")
    if clvalue == 'Rate Zone':
        print("Rate Zone Report")
    if clvalue == 'Rate Group ID':
        print("Rating group Report")
    if clvalue == 'Service Type':
        print("Service Report")
    if clvalue == 'Endpoint ID':
        print("Endpoint Report")
    if clvalue == 'CUSTOMER ID	':
        print("Customer Report")


def validate_ota_file(filepath: str, tab: str = 'Closed', headers: list = None, filterBy: str = None):
    try:
        rows = []

        with open(filepath, 'r') as csvfile:
            csvreader = csv.reader(csvfile)
            fields = next(csvreader)
            for row in csvreader:
                rows.append(row)
            print("Total no. of rows: %d" % (csvreader.line_num))
        print('Field names are:' + ', '.join(field for field in fields))
        field = [row for field in fields]
        columns = str(field[0]).split(";")
        print(columns)
        res = {}

        counter = 1
        for row in rows:
            row = str(row)
            print(row)
            counter += 1
            if tab == 'Closed' and row.__eq__("CampaignList_Closed"):
                print("CampaignList_Closed header verified")
            elif tab == 'Processing' and row.__eq__("CampaignList_Processing"):
                print("CampaignList_Processing header verified")
            elif tab == 'Rule_Set':
                print("Rule_Set header verified")
            elif tab == 'Message_Set':
                print("Message_Set header verified")
            if counter == 2 and headers:
                temp: list = row.split(",")
                row = [str(each_string).lower() for each_string in row]
                headers = [str(each_string).lower() for each_string in headers]
                if functools.reduce(lambda x, y: x and y, map(lambda a, b: a == b, headers, temp), True):
                    print("Headers matched")
            if counter > 3:
                if filterBy and row.__contains__(filterBy):
                    print("Filtered data available in file")
    except StopIteration:
        print("Occurred Stop Iteration")


def capitalize_string(data: str):
    return data.capitalize()


def validate_excel_AccountPage(filepath: str, type):
    vk = openpyxl.load_workbook(filepath)
    sheet = vk.active
    print(sheet)
    print(sheet['C3'].value)
    if sheet['A3'].value == 'mvnoId':
        print("mvnoId")
    if sheet['B3'].value == 'customerName':
        print("customerName")
    if sheet['C3'].value == 'tierId':
        print("tierId")
    if sheet['D3'].value == 'customerType':
        print("customerType")
    if sheet['E3'].value == 'onBoardType':
        print("onBoardType")
    if sheet['F3'].value == 'country':
        print("country")
    if sheet['G3'].value == 'connectionType':
        print("connectionType")
    if sheet['H3'].value == 'currentStatus':
        print("currentStatus")
    if sheet['I3'].value == 'cost':
        print("cost")
    if sheet['J3'].value == 'balance':
        print("balance")
    if sheet['K3'].value == 'accountEmail':
        print("accountEmail")


def add_elements_to_map(data: dict, key: str, value: str):
    data[key] = value


