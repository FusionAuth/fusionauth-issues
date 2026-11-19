import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.List;
import javax.xml.XMLConstants;
import javax.xml.crypto.dsig.CanonicalizationMethod;
import javax.xml.crypto.dsig.DigestMethod;
import javax.xml.crypto.dsig.SignatureMethod;
import javax.xml.crypto.dsig.Transform;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.dom.DOMSignContext;
import javax.xml.crypto.dsig.spec.C14NMethodParameterSpec;
import javax.xml.crypto.dsig.spec.TransformParameterSpec;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.Element;

class SignAssertion {
  public static void main(String[] args) throws Exception {
    var parser = DocumentBuilderFactory.newInstance();
    parser.setNamespaceAware(true);
    parser.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    parser.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
    parser.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
    var doc = parser.newDocumentBuilder().parse(new File(args[0]));
    var assertion = (Element) doc.getElementsByTagNameNS("urn:oasis:names:tc:SAML:2.0:assertion", "Assertion").item(0);
    assertion.setIdAttribute("ID", true);
    var key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(Path.of(args[1]))));
    var factory = XMLSignatureFactory.getInstance("DOM");
    var transforms = List.of(
        factory.newTransform(Transform.ENVELOPED, (TransformParameterSpec) null),
        factory.newTransform(CanonicalizationMethod.EXCLUSIVE, (TransformParameterSpec) null));
    var reference = factory.newReference("#" + assertion.getAttribute("ID"),
        factory.newDigestMethod(DigestMethod.SHA256, null), transforms, null, null);
    var info = factory.newSignedInfo(
        factory.newCanonicalizationMethod(CanonicalizationMethod.EXCLUSIVE, (C14NMethodParameterSpec) null),
        factory.newSignatureMethod(SignatureMethod.RSA_SHA256, null), List.of(reference));
    var context = new DOMSignContext(key, assertion, assertion.getFirstChild().getNextSibling());
    context.setDefaultNamespacePrefix("ds");
    factory.newXMLSignature(info, null).sign(context);
    TransformerFactory.newInstance().newTransformer().transform(new DOMSource(doc), new StreamResult(System.out));
  }
}
