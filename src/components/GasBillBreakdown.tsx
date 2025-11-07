import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GasBillBreakdownProps {
  data: any;
}

export const GasBillBreakdown = ({ data }: GasBillBreakdownProps) => {
  if (!data || data.length === 0) return null;

  const bill = data[0]; // First gas bill

  return (
    <div className="space-y-4">
      {/* Supplier & Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">🔥 Gas Bill Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold">Supplier:</span> {bill.supplier_details?.name || 'N/A'}
            </div>
            <div>
              <span className="font-semibold">Tariff:</span> {bill.supplier_details?.tariff_name || 'N/A'}
            </div>
            <div>
              <span className="font-semibold">Invoice Number:</span> {bill.gas_details?.invoice_number || 'N/A'}
            </div>
            <div>
              <span className="font-semibold">Account Number:</span> {bill.gas_details?.account_number || 'N/A'}
            </div>
            <div>
              <span className="font-semibold">Issue Date:</span> {bill.supplier_details?.issue_date || 'N/A'}
            </div>
            <div>
              <span className="font-semibold">Billing Period:</span> {bill.supplier_details?.billing_period || 'N/A'}
            </div>
            <div>
              <span className="font-semibold">Contract End:</span> {bill.gas_details?.contract_end_date || 'N/A'}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Meter Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meter Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm">
            <span className="font-semibold">GPRN:</span> {bill.gas_details?.meter_details?.gprn || 'N/A'}
          </div>
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
                  <TableHead>Meter Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Reading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.charges_and_usage.meter_readings.map((reading: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{reading.meter_type || '-'}</TableCell>
                    <TableCell>{reading.date || '-'}</TableCell>
                    <TableCell className="text-right font-medium">{reading.reading || 0}</TableCell>
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
            <CardTitle className="text-base">Unit Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              <span className="font-semibold">Rate:</span> {bill.charges_and_usage.unit_rates.rate || 0} {bill.charges_and_usage.unit_rates.rate_currency || 'cent'} per unit
            </div>
          </CardContent>
        </Card>
      )}

      {/* Standing Charges & Carbon Tax */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Standing Charges & Taxes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold">Standing Charge:</span> {bill.charges_and_usage?.standing_charge || 0} {bill.charges_and_usage?.standing_charge_currency || 'euro'} ({bill.charges_and_usage?.standing_charge_period || 'annual'})
            </div>
            <div>
              <span className="font-semibold">Carbon Tax:</span> €{bill.charges_and_usage?.carbon_tax || 0}
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
