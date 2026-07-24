import csv


def remove_value_from_csv(filename, columnname, valuetoremove):
    # open the CSV file for reading and create a list of dictionaries
    with open(filename, 'r') as csvfile:
        reader = csv.DictReader(csvfile)
        data = list(reader)

    # modify the list to remove the desired value
    for row in data:
        if row[columnname] == valuetoremove:
            data.remove(row)

    # write the modified list back to the CSV file
    with open(filename, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=reader.fieldnames)
        writer.writeheader()
        writer.writerows(data)
