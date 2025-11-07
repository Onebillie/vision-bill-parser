import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoGrid } from "@/components/InfoGrid";

interface ElectricityBillBreakdownProps {
  data: any;
}

export const ElectricityBillBreakdown = ({ data }: ElectricityBillBreakdownProps) => {
  if (!data || data.length === 0) return null;

  const bill = data[0]; // First electricity bill

  return (
    <div className="space-y-4">
      {/* Supplier & Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">⚡ Electricity Bill Details</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid items={[
            { label: "Supplier", value: bill.supplier_details?.name },
            { label: "Tariff", value: bill.supplier_details?.tariff_name },
            { label: "Invoice Number", value: bill.electricity_details?.invoice_number },
            { label: "Account Number", value: bill.electricity_details?.account_number },
            { label: "Issue Date", value: bill.supplier_details?.issue_date },
            { label: "Billing Period", value: bill.supplier_details?.billing_period },
            { label: "Contract End", value: bill.electricity_details?.contract_end_date }
          ]} />
        </CardContent>
      </Card>

      {/* Meter Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meter Information</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoGrid columns={4} items={[
            { label: "MPRN", value: bill.electricity_details?.meter_details?.mprn },
            { label: "DG", value: bill.electricity_details?.meter_details?.dg },
            { label: "MCC", value: bill.electricity_details?.meter_details?.mcc },
            { label: "Profile", value: bill.electricity_details?.meter_details?.profile }
          ]} />
        </CardContent>
      </Card>

      {/* Meter Readings */}
      {bill.charges_and_usage?.meter_readings && bill.charges_and_usage.meter_readings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Meter Readings</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reading Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">NSH</TableHead>
                  <TableHead className="text-right">Day</TableHead>
                  <TableHead className="text-right">Night</TableHead>
                  <TableHead className="text-right">Peak</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.charges_and_usage.meter_readings.map((reading: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{reading.reading_type || '-'}</TableCell>
                    <TableCell>{reading.date || '-'}</TableCell>
                    <TableCell className="text-right">{reading.nsh_reading || 0}</TableCell>
                    <TableCell className="text-right">{reading.day_reading || 0}</TableCell>
                    <TableCell className="text-right">{reading.night_reading || 0}</TableCell>
                    <TableCell className="text-right">{reading.peak_reading || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detailed kWh Usage */}
      {bill.charges_and_usage?.detailed_kWh_usage && bill.charges_and_usage.detailed_kWh_usage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Energy Usage (kWh)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period Start</TableHead>
                  <TableHead>Period End</TableHead>
                  <TableHead className="text-right">Day kWh</TableHead>
                  <TableHead className="text-right">Night kWh</TableHead>
                  <TableHead className="text-right">Peak kWh</TableHead>
                  <TableHead className="text-right">EV kWh</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.charges_and_usage.detailed_kWh_usage.map((usage: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{usage.start_read_date || '-'}</TableCell>
                    <TableCell>{usage.end_read_date || '-'}</TableCell>
                    <TableCell className="text-right font-medium">{usage.day_kWh || 0}</TableCell>
                    <TableCell className="text-right font-medium">{usage.night_kWh || 0}</TableCell>
                    <TableCell className="text-right font-medium">{usage.peak_kWh || 0}</TableCell>
                    <TableCell className="text-right font-medium">{usage.ev_kWh || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Unit Rates */}
      {bill.charges_and_usage?.unit_rates && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unit Rates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-semibold">24 Hour Rate:</span> {bill.charges_and_usage.unit_rates['24_hour_rate'] || 0} {bill.charges_and_usage.unit_rates.rate_currency || 'cent'}
              </div>
              <div>
                <span className="font-semibold">Day Rate:</span> {bill.charges_and_usage.unit_rates.day || 0} {bill.charges_and_usage.unit_rates.rate_currency || 'cent'}
              </div>
              <div>
                <span className="font-semibold">Night Rate:</span> {bill.charges_and_usage.unit_rates.night || 0} {bill.charges_and_usage.unit_rates.rate_currency || 'cent'}
              </div>
              <div>
                <span className="font-semibold">Peak Rate:</span> {bill.charges_and_usage.unit_rates.peak || 0} {bill.charges_and_usage.unit_rates.rate_currency || 'cent'}
              </div>
              <div>
                <span className="font-semibold">EV Rate:</span> {bill.charges_and_usage.unit_rates.ev || 0} {bill.charges_and_usage.unit_rates.rate_currency || 'cent'}
              </div>
              <div>
                <span className="font-semibold">NSH Rate:</span> {bill.charges_and_usage.unit_rates.nsh || 0} {bill.charges_and_usage.unit_rates.rate_currency || 'cent'}
              </div>
              {bill.charges_and_usage.unit_rates.rate_discount_percentage > 0 && (
                <div>
                  <span className="font-semibold">Discount:</span> {bill.charges_and_usage.unit_rates.rate_discount_percentage}%
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Standing Charges & PSO Levy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Standing Charges & Levies</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold">Standing Charge:</span> {bill.charges_and_usage?.standing_charge || 0} {bill.charges_and_usage?.standing_charge_currency || 'euro'} ({bill.charges_and_usage?.standing_charge_period || 'annual'})
            </div>
            {bill.charges_and_usage?.nsh_standing_charge > 0 && (
              <div>
                <span className="font-semibold">NSH Standing Charge:</span> {bill.charges_and_usage.nsh_standing_charge} {bill.charges_and_usage.nsh_standing_charge_currency || 'euro'} ({bill.charges_and_usage.nsh_standing_charge_period || 'annual'})
              </div>
            )}
            <div>
              <span className="font-semibold">PSO Levy:</span> {bill.charges_and_usage?.pso_levy || 0}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Financial Summary */}
      <Card className="border-2 border-primary">
        <CardHeader>
          <CardTitle className="text-base">Financial Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold">Total Due:</span> <span className="text-lg font-bold">€{bill.financial_information?.total_due || 0}</span>
            </div>
            <div>
              <span className="font-semibold">Amount Due:</span> <span className="text-lg font-bold">€{bill.financial_information?.amount_due || 0}</span>
            </div>
            <div>
              <span className="font-semibold">Due Date:</span> {bill.financial_information?.due_date || 'N/A'}
            </div>
            <div>
              <span className="font-semibold">Payment Due Date:</span> {bill.financial_information?.payment_due_date || 'N/A'}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
